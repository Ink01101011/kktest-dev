// redact.mjs: the #19 redaction gaps, a prefix x body x suffix corpus (>= 3990 cases), over-redaction guards,
// and a linear-time check per regex family. Run: node --test "plugins/kktestdev-pack/skills/kk-onboard/scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from './redact.mjs';
import * as I from './inventory.mjs';

const { redactText, redactArgs, redactPasses, replaceKeyValues, secretKey } = R;
const S = 'ZZsecretZZ9';
const masked = (s) => !redactText(s).text.includes(S);

// ---------------------------------------------------------------- corpus (generator)
// The g8 corpus (3990 cases: 35 prefixes x 38 bodies x 3 suffixes) plus the #19 gap forms and forms from
// inventory.test.mjs. The old code (master) was diffed against this corpus outside the suite: 0 cases it
// masked are unmasked now. Inside the suite the stronger claim is pinned: EVERY case is masked except the
// ARTIFACTS below, where a word character glued in front turns the command or key into another word
// (`_curl`, `amysql`, `-sshpass`, `aapi_key`); the old code leaked every one of those too.
const PREFIXES = ['', ' ', '"', "'", '(', ')', ',', ';', '?', '&', '/', '\\', '-', '--', 'x-', 'x--', '_', '.', ':', '=', '{', '[', '>', '|', '$', '@', '#', '1', '9', 'a', 'é', '`', '\n', '\t', '<'];
const SUFFIXES = ['', '!', ' x'];
const G8_BODIES = [
  `token=${S}`, `api_key=${S}`, `password=${S}`, `"token":"${S}"`, `"api_key": "${S}"`, `'secret':'${S}'`, `Authorization: Bearer ${S}`, `Authorization: Basic ${S}`, `--token=${S}`, `--token ${S}`, `--api-key=${S}`, `API_KEY=${S}`, `client_secret=${S}`, `passwd:${S}`,
  `https://bob:${S}@host/x`, `https://host/x?key=${S}`, `https://host/x?access_token=${S}`, `ftp://u:${S}@h`, `postgres://u:${S}@h/db`, `git+https://u:${S}@h/r.git`,
  `curl -u bob:${S} http://h`, `curl -ubob:${S} h`, `curl --user=bob:${S} h`, `curl -vu bob:${S} h`, `wget --user bob --password ${S}`, `mysql -p${S} -uroot`, `mysql -u root -p${S}`, `mysqldump --password=${S}`, `sk-${S}${S}`, `ghp_${S}${'a'.repeat(20)}`, `AKIA${'A'.repeat(16)}`,
  `x-api-key: ${S}`, `X-Auth-Token: ${S}`, `cookie: session=${S}`, `DB_PASSWORD=${S} node a.js`, `env FOO=1 TOKEN=${S}`, `secret = ${S}`, `token : ${S}`,
];
const GAP_BODIES = [
  `mysql -u root -p ${S}`, `sshpass -p ${S} ssh h`, `mongo -u bob -p ${S}`, // separate -p VALUE
  `PGPASSWORD=${S} psql -h h`, // glued secret word
  `sshpass -p${S} ssh h`, `7z x -p${S} a.7z`, `tool -p${S}`, // -pX outside MySQL
  `{"token":"${S}"}`, `{\\"token\\":\\"${S}\\"}`, // JSON keys in free text, also shell-escaped
  `user@host.com: password = ${S}`, `Host:"h" "password": ${S}`, // keys after an earlier host: key
  `git clone bob:${S}@host.example.com/r`, `bob:${S}@db.example.com:5432`, // schemeless userinfo
  `API_KEY = "${S}"`, `password  =  ${S}`, // KEY = value with spaces
  `{"token": 1234${S}}`, `{'token': '${S}'}`, `{'api_key': ${S}}`, // unquoted values, single-quoted keys
];
const TEST_BODIES = [`curl -u bob:${S} https://x && mysql -uroot -p${S} db`, `docker run img mytool -u bob:${S}`, `Example: DEMO_TOKEN=${S} x=1`];
const BODIES = [...G8_BODIES, ...GAP_BODIES, ...TEST_BODIES];
function* corpus() { for (const p of PREFIXES) for (const b of BODIES) for (const s of SUFFIXES) yield [p, b, s]; }
const WORD_GLUE = ['_', '1', '9', 'a'];
const ARTIFACTS = new Map([
  [`sshpass -p ${S} ssh h`, ['-', '--', 'x-', 'x--', ...WORD_GLUE]], [`mongo -u bob -p ${S}`, ['-', '--', 'x-', 'x--', ...WORD_GLUE]],
  [`curl -ubob:${S} h`, WORD_GLUE], [`curl -vu bob:${S} h`, WORD_GLUE], [`sk-${S}${S}`, WORD_GLUE], [`ghp_${S}${'a'.repeat(20)}`, WORD_GLUE],
  [`mysql -u root -p ${S}`, WORD_GLUE], [`api_key=${S}`, ['a']], [`cookie: session=${S}`, ['a']],
]);

test('#19: redact.mjs is the one implementation; inventory.mjs re-exports it', () => {
  for (const k of ['redactText', 'redactUrl', 'redactArgs', 'inlineSecretKeys', 'secretKey', 'splitShell', 'cutAtWhitespace', 'replaceKeyValues']) assert.equal(I[k], R[k], k);
  assert.equal(I.LIMITS.redactChars, R.REDACT_CHARS);
});

test('#19 corpus: >= 3990 cases, every one masked except the glued-word artifacts', () => {
  let n = 0; const leaks = [];
  for (const [p, b, s] of corpus()) {
    n++;
    if (!masked(p + b + s) && !(ARTIFACTS.get(b) ?? []).includes(p)) leaks.push(JSON.stringify(p + b + s) + ' => ' + JSON.stringify(redactText(p + b + s).text));
  }
  assert.ok(n >= 3990, `corpus has ${n} cases`);
  assert.deepEqual(leaks.slice(0, 10), [], `${leaks.length} leaks`);
});

// ---------------------------------------------------------------- the eight gaps, one test each
test('#19 gap 1: separate -p VALUE is masked in password -p commands only (rule: port elsewhere)', () => {
  assert.equal(redactText(`mysql -u root -p ${S}`).text, 'mysql -u root -p ***'); // MySQL: really a db name; masked anyway (display only)
  assert.equal(redactText(`sshpass -p ${S} ssh h`).text, 'sshpass -p *** ssh h');
  assert.equal(redactText(`mongo -u bob -p ${S} db`).text, 'mongo -u bob -p *** db');
  assert.equal(redactText('mysql -u root -p -h db').text, 'mysql -u root -p -h db'); // a flag after -p is not a value
  assert.equal(redactText('sshpass -p $SSHPASS ssh h').text, 'sshpass -p $SSHPASS ssh h');
  assert.equal(redactText('ssh -p 2222 h && docker run -p 8080:80 img').text, 'ssh -p 2222 h && docker run -p 8080:80 img');
  assert.deepEqual(redactArgs(['-p', S, 'ssh', 'h'], 'sshpass').args, ['-p', '***', 'ssh', 'h']);
  assert.deepEqual(redactArgs(['-p', '2222', 'h'], 'ssh').args, ['-p', '2222', 'h']);
});

test('#19 gap 2: a secret word glued to a prefix (PGPASSWORD) is a secret key', () => {
  assert.equal(redactText(`PGPASSWORD=${S} psql -h h`).text, 'PGPASSWORD=*** psql -h h');
  assert.ok(secretKey('PGPASSWORD') && secretKey('csrftoken') && secretKey('APPSECRET') && secretKey('dbPassword'));
  assert.ok(!secretKey('MAX_TOKENS') && !secretKey('tokenizer') && !secretKey('AUTHOR_NAME') && !secretKey('passive'));
});

test('#19 gap 3: glued -pX outside MySQL is masked unless it looks like a port, flags or a path', () => {
  assert.equal(redactText(`sshpass -p${S} ssh h`).text, 'sshpass -p*** ssh h');
  assert.equal(redactText(`7z x -p${S} a.7z`).text, '7z x -p*** a.7z');
  assert.equal(redactText(`tool -p${S}`).text, 'tool -p***');
  assert.deepEqual(redactArgs([`-p${S}`], 'tool').args, ['-p***']);
  for (const keep of ['serve -p8080', 'docker run -p8080:80/udp img', 'docker run -p127.0.0.1:8080:80 img', 'mkdir -pv d', 'cp -pr a b', 'gcc -pthread -pedantic x.c', 'pytest -pno:cacheprovider', 'tool -p./dir', 'tool -p$PW', 'tool -p[::1]:80'])
    assert.equal(redactText(keep).text, keep);
  assert.deepEqual(redactArgs(['-p8080'], 'node').args, ['-p8080']);
});

test('#19 gap 4: JSON-quoted keys in free text, also shell-escaped', () => {
  assert.equal(redactText(`{"token":"${S}"}`).text, '{"token":"***"}');
  assert.equal(redactText(`echo {\\"token\\":\\"${S}\\"}`).text, 'echo {\\"token\\":***}');
  assert.equal(redactText(`{"api_key": "${S}", "name": "n"}`).text, '{"api_key": "***", "name": "n"}');
});

test('#19 gap 5: keys after an earlier host: key', () => {
  for (const s of [`user@host.com: password = ${S}`, `Host:"h" "password": ${S}`, `Host: h.com:password=${S}`, `host: h, token: ${S}`, `db.host:5432:password=${S}`])
    assert.ok(masked(s), s + ' => ' + redactText(s).text);
  assert.equal(redactText(`user@host.com: password = ${S}`).text, 'user@host.com: password = ***');
});

test('#19 gap 6: schemeless userinfo user:password@host', () => {
  assert.equal(redactText(`git clone bob:${S}@host.example.com/r`).text, 'git clone bob:***@host.example.com/r');
  assert.equal(redactText(`bob:${S}@db.example.com:5432`).text, 'bob:***@db.example.com:5432');
  assert.equal(redactText(`/bob:${S}@localhost`).text, '/bob:***@localhost');
  assert.equal(redactText('bob:${PW}@db.example.com').text, 'bob:${PW}@db.example.com');
  for (const keep of ['git@github.com:org/repo.git', 'image:1.2@sha256:abcdef', 'mailto:me@example.com', 'npx -y @scope/pkg@latest', 'reg:5000/img@sha256:ab'])
    assert.equal(redactText(keep).text, keep);
});

test('#19 gap 7: KEY = value with blanks around = or :', () => {
  assert.equal(redactText(`secret = ${S}`).text, 'secret = ***');
  assert.equal(redactText(`token : ${S}`).text, 'token : ***'); // was `token *** S`: Token taken as an auth scheme
  assert.equal(redactText(`API_KEY = "${S}"`).text, 'API_KEY = ***');
  assert.equal(redactText(`password  =  ${S}`).text, 'password  =  ***');
  assert.equal(redactText(`password =\n${S}`).text, `password =\n${S}`); // blanks never cross a newline (prose)
  for (const keep of ['if token == x', 'name = demo', 'port = 5432']) assert.equal(redactText(keep).text, keep);
});

test('#19 gap 8: unquoted numeric values and single-quoted keys', () => {
  assert.equal(redactText('{"token": 12345678}').text, '{"token": ***');
  assert.equal(redactText(`{'token': '${S}'}`).text, "{'token': ***}");
  assert.equal(redactText(`{'api_key': ${S}}`).text, "{'api_key': ***");
  assert.equal(redactText('{"token": "***"}').text, '{"token": "***"}'); // already masked: not masked twice
});

test('#19 over-redaction: benign strings are unchanged', () => {
  const benign = ['node /Users/me/x.js --verbose', 'serve -p8080', 'ssh -p2222 host', 'docker run -p 8080:80 img', 'mkdir -p build/out', 'git log -p',
    'Status: connected', 'timeout: 30', 'host: db.example.com', 'docker run -u 1000:1000 img', 'http://localhost:3000/path',
    'a = b', 'x == y', 'tokens: 1200', 'max_tokens=4096', 'user@example.com', 'scp file host:/tmp', 'mongo --port 27017',
    'python -m http.server 8000', 'PATH=/usr/bin:$PATH node x', 'author: Jane', 'passive: true', 'tokenizer: bpe', 'version: 1.2.3', 'node@22.1.0'];
  const changed = benign.filter((b) => redactText(b).text !== b);
  assert.deepEqual(changed, []);
});

// ---------------------------------------------------------------- linear time
// Each family targets one pass: 200k adversarial chars through redactPasses (no 20k cut) must finish under a
// fixed budget, and doubling the input must roughly double the time (quadratic would quadruple it).
const FAMILIES = {
  word: 'ab', wordColon: 'ab' + ' ', keyRun: 'a=', keyBlank: 'token ', keyQuote: 'a" ', keyEsc: 'a\\"', escValue: 'token=\\"x', pairOpen: 'a="',
  userinfo: 'a:b!', userinfoHost: 'a:b@c.', userinfoRun: 'a.b:c@', url: 'a://', scheme: 'a+',
  auth: 'Token :', flag: '--token ', sepP: 'mysql -p ', gluedP: ' -px', userFlag: '-u a:', shell: 'a;"', ws: ' \t',
};
const BUDGET_MS = 1500;
const timeMs = (s) => { let best = Infinity; for (let i = 0; i < 5; i++) { const t0 = process.hrtime.bigint(); redactPasses(s); best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6); if (best > BUDGET_MS) break; } return best; };
test('#19 linear time: every pass family, up to 400k adversarial chars, 4x input stays well under quadratic', () => {
  for (const [name, unit] of Object.entries(FAMILIES)) {
    // sizes go up so a quadratic pass fails at a small size instead of running for minutes
    const t = {};
    for (const n of [25000, 50000, 100000, 200000, 400000]) {
      t[n] = timeMs(unit.repeat(Math.ceil(n / unit.length)));
      assert.ok(t[n] < BUDGET_MS, `${name}: ${t[n].toFixed(0)} ms on ${n} chars`);
    }
    // ratio only means something above timer noise. 4x the input: linear ~4x, quadratic ~16x; 10x leaves room
    // for a noisy CI runner (a 200k->400k ratio of 3 failed on a shared macOS runner at 26 -> 85 ms).
    if (t[400000] > 30) assert.ok(t[400000] / t[100000] < 10, `${name}: 100k ${t[100000].toFixed(1)} ms, 400k ${t[400000].toFixed(1)} ms`);
  }
  const t0 = process.hrtime.bigint(); replaceKeyValues('token '.repeat(70000)); // the key scan alone
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 1500);
});
