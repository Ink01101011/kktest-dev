// Filesystem helpers for writing into tool configs safely (G2-01/02/03/06, G3-X1/X2).
//
// - Temp files, temp folders and backups get unpredictable names and are created exclusively
//   (O_CREAT|O_EXCL), so a planted file or symlink at a guessable name is never followed.
// - A config keeps its mode across a rewrite; a new config is created 0600.
// - Renames retry on win32 when an indexer or antivirus holds the file (EPERM/EBUSY/EACCES), and
//   folder moves fall back to copy + delete across volumes (EXDEV).
// - `checkTarget` decides whether a destination may be written at all (symlinks, containment).
//
// Every fs call goes through the default `fs` object so tests can inject errors by patching it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Error raised while applying a plan; the CLI prints it as one `ERROR:` line and exits 2. */
export class ApplyError extends Error {}

export const rand = () => crypto.randomBytes(6).toString('hex');
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
export const RETRY_DELAYS_MS = [20, 40, 80, 160, 320, 480];

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** rename(2), retried with backoff on win32 for the transient errors AV scanners and indexers cause. */
export function renameRetry(from, to, { platform = process.platform, delays = RETRY_DELAYS_MS } = {}) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      if (platform !== 'win32' || !RETRY_CODES.has(e.code) || i >= delays.length) throw e;
      sleep(delays[i]);
    }
  }
}

/** Move a folder; across volumes (EXDEV) copy it and delete the source. */
export function moveDir(from, to, opts = {}) {
  try {
    renameRetry(from, to, opts);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    try {
      fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true, preserveTimestamps: true });
    } catch (ce) {
      fs.rmSync(to, { recursive: true, force: true });
      throw ce;
    }
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/** A path next to `base` that does not exist yet: base, else base-<random>. */
export function freshPath(base) {
  if (!lexists(base)) return base;
  for (;;) {
    const p = `${base}-${rand()}`;
    if (!lexists(p)) return p;
  }
}

export function lexists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false;
    throw e;
  }
}

/** Mode bits to keep for `file` (0600 for a new config). */
export function modeOf(file) {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return 0o600;
  }
}

/** Write `content` to `file` atomically: exclusive random temp file in the same folder, then rename. */
export function atomicWrite(file, content, { mode = 0o600, platform = process.platform } = {}) {
  const tmp = `${file}.kktest-dev.tmp-${rand()}`;
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    try {
      fs.fchmodSync(fd, mode); // `mode` above is masked by the umask
    } catch (e) {
      if (platform !== 'win32') throw e;
    }
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.closeSync(fd);
  try {
    renameRetry(tmp, file, { platform });
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Copy `file` to a new, unique `<file>.kktest-dev.bak-<ts>-<random>` (never through a planted link). */
export function backupFile(file, ts) {
  const bak = `${file}.kktest-dev.bak-${ts}-${rand()}`;
  fs.copyFileSync(file, bak, fs.constants.COPYFILE_EXCL);
  try {
    fs.chmodSync(bak, fs.statSync(file).mode & 0o777);
  } catch {
    // best effort (win32 has no POSIX modes)
  }
  return bak;
}

const inside = (child, parent, win) => {
  const [c, pr] = win ? [child.toLowerCase(), parent.toLowerCase()] : [child, parent];
  const sep = win ? '\\' : '/';
  return c === pr || c.startsWith(pr.endsWith(sep) ? pr : pr + sep);
};

function realOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * May `dest` be written? `root` is the folder the destination was derived from (the project for
 * --scope project; HOME, CODEX_HOME or the app-data folder for user scope).
 *
 * - project scope: every existing path component below the root must be a real folder or file,
 *   not a symlink, and the resolved path must stay inside the root (a cloned repo is untrusted).
 * - user scope: a symlinked config (dotfiles) is followed only when it resolves inside the root;
 *   the write then goes to the link's target, so the link keeps working.
 * - a folder destination that is itself a symlink is never replaced, in either scope.
 *
 * @returns {{ok: true, real: string} | {ok: false, reason: string}}
 */
export function checkTarget(dest, { root, scope, kind = 'file', platform = process.platform }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const win = platform === 'win32';
  const rel = p.relative(root, dest);
  if (!rel || rel.startsWith('..') || p.isAbsolute(rel)) return { ok: false, reason: `${dest} is not inside ${root}` };
  const rootReal = realOrNull(root);
  if (!rootReal) return { ok: true, real: dest }; // nothing below a missing root exists yet
  let cur = root;
  const parts = rel.split(p.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cur = p.join(cur, parts[i]);
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch (e) {
      if (e.code === 'ENOENT') break;
      throw e;
    }
    if (!st.isSymbolicLink()) continue;
    const real = realOrNull(cur);
    const shown = real ?? `${fs.readlinkSync(cur)} (missing)`;
    if (scope === 'project') {
      return { ok: false, reason: `${cur} is a symbolic link (-> ${shown}); kktest-dev never writes through links inside a project, since a cloned repo can point them anywhere` };
    }
    if (i === parts.length - 1 && kind === 'dir') {
      return { ok: false, reason: `${cur} is a symbolic link (-> ${shown}); kktest-dev will not replace a linked folder` };
    }
    if (!real || !inside(real, rootReal, win)) {
      return { ok: false, reason: `${cur} is a symbolic link to ${shown}, outside ${root}; kktest-dev will not write through it` };
    }
  }
  // Resolve the deepest existing ancestor and re-attach the rest.
  let base = dest;
  const tail = [];
  let real = null;
  while (real === null) {
    real = realOrNull(base);
    if (real === null) {
      tail.unshift(p.basename(base));
      const up = p.dirname(base);
      if (up === base) return { ok: true, real: dest };
      base = up;
    }
  }
  const resolved = tail.length ? p.join(real, ...tail) : real;
  if (!inside(resolved, rootReal, win)) return { ok: false, reason: `${dest} resolves to ${resolved}, outside ${root}` };
  return { ok: true, real: resolved };
}

/**
 * Exclusive lock under `dir` (our ~/.kktest-dev) so two installs never interleave. The lock file is
 * written in full under a temp name and then hard-linked into place, so another process never sees
 * it without its pid (an empty lock read as "stale" let two installs run at once).
 */
export function acquireLock(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'install.lock');
  const mine = path.join(dir, `install.lock.${process.pid}-${rand()}`);
  fs.writeFileSync(mine, String(process.pid), { flag: 'wx', mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.linkSync(mine, file);
        return () => fs.rmSync(file, { force: true });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let pid = NaN;
        try {
          pid = Number.parseInt(fs.readFileSync(file, 'utf8'), 10);
        } catch {
          continue; // released meanwhile: try again
        }
        let alive = true;
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (ke) {
            alive = ke.code === 'EPERM';
          }
        }
        if (alive) throw new ApplyError(`another kktest-dev install is running (pid ${Number.isNaN(pid) ? '?' : pid}); wait for it, or delete ${file} if it is not`);
        fs.rmSync(file, { force: true }); // stale lock from a crashed run
      }
    }
    throw new ApplyError(`could not take the lock ${file}`);
  } finally {
    fs.rmSync(mine, { force: true });
  }
}
