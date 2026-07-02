// Shared persistence + lifecycle helpers, used by both index.js (MCP server)
// and gate.mjs (Stop-hook enforcer). All I/O lives here; ledger.js stays pure.

import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const LEDGER_DIR = process.env.LOOP_LEDGER_DIR || join(homedir(), ".loop-ledger");
mkdirSync(LEDGER_DIR, { recursive: true });

const TTL_HOURS = Number(process.env.LOOP_LEDGER_TTL_HOURS || 168); // closed loops: 7d
const MAX_AGE_HOURS = Number(process.env.LOOP_LEDGER_MAX_AGE_HOURS || 720); // any loop: 30d

export const pathFor = (id) => join(LEDGER_DIR, `${id}.json`);
export const load = (id) => (existsSync(pathFor(id)) ? JSON.parse(readFileSync(pathFor(id), "utf8")) : null);
export const save = (loop) => writeFileSync(pathFor(loop.id), JSON.stringify(loop, null, 2));

// Active-loop pointer: the single loop currently enforced by the Stop hook.
const ACTIVE_PATH = join(LEDGER_DIR, "ACTIVE.json");
export const readActive = () => (existsSync(ACTIVE_PATH) ? JSON.parse(readFileSync(ACTIVE_PATH, "utf8")) : null);
export const writeActive = (ptr) => writeFileSync(ACTIVE_PATH, JSON.stringify(ptr, null, 2));
export const clearActive = () => { try { if (existsSync(ACTIVE_PATH)) unlinkSync(ACTIVE_PATH); } catch {} };

let counter = 0;
export const genId = () => `loop_${Date.now().toString(36)}_${(counter++).toString(36)}`;

// Delete closed loops past TTL and any loop past MAX_AGE. Never touches ACTIVE.json.
// `now` is injectable for tests. Returns count deleted.
export function sweep(now = Date.now()) {
  let deleted = 0;
  let files;
  try { files = readdirSync(LEDGER_DIR); } catch { return 0; }
  for (const f of files) {
    if (!f.startsWith("loop_") || !f.endsWith(".json")) continue;
    const p = join(LEDGER_DIR, f);
    let loop;
    try { loop = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
    const ageH = (now - (loop.created_at || 0)) / 3.6e6;
    const closedAgeH = loop.closed_at ? (now - loop.closed_at) / 3.6e6 : null;
    const stale =
      (loop.closed && closedAgeH != null && closedAgeH > TTL_HOURS) || ageH > MAX_AGE_HOURS;
    if (stale) {
      try { unlinkSync(p); deleted++; } catch {}
    }
  }
  return deleted;
}
