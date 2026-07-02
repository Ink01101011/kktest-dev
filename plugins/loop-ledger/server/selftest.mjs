// Zero-dependency self-test for the loop-ledger plugin.
// Speaks raw MCP JSON-RPC to index.js (no SDK), then checks the gate.mjs branches.
// Run: node server/selftest.mjs   (from the plugin root, or `node selftest.mjs` here)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "loop-ledger-selftest-"));
const env = { ...process.env, LOOP_LEDGER_DIR: dir };
let fail = 0;
const check = (n, c) => { console.log(`  ${c ? "ok  " : "FAIL"} ${n}`); if (!c) fail++; };

// ---- 1. raw JSON-RPC handshake against index.js ----
const srv = spawn("node", [join(HERE, "index.js")], { env, stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let buf = "";
srv.stdout.on("data", (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const call = (id, method, params) => new Promise((res) => { pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
const notify = (method, params) => srv.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
const unwrap = (r) => r.result.structuredContent ?? JSON.parse(r.result.content[0].text);

const init = await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
check("initialize returns serverInfo", init.result?.serverInfo?.name === "loop-ledger");
notify("notifications/initialized");

const list = await call(2, "tools/list");
const names = list.result.tools.map((t) => t.name).sort();
console.log("  tools:", names.join(", "));
for (const t of ["loop_start", "loop_tick", "loop_status", "loop_end", "loop_gc"]) check(`has ${t}`, names.includes(t));

const start = unwrap(await call(3, "tools/call", { name: "loop_start", arguments: { goal: "selftest", max_iterations: 5, exit_mode: "manual" } }));
check("loop_start → loop_id", !!start.loop_id);

let last;
for (let i = 0; i < 3; i++) {
  last = unwrap(await call(10 + i, "tools/call", { name: "loop_tick", arguments: { loop_id: start.loop_id, state: "X" } }));
}
check("3 identical ticks → stalled", last.status === "stalled" && last.should_continue === false);

srv.stdin.end();
srv.kill();

// ---- 2. gate.mjs branches ----
const gate = (stdin) => spawnSync("node", [join(HERE, "gate.mjs")], { input: stdin, env, encoding: "utf8" });
const STOP = JSON.stringify({ hook_event_name: "Stop", stop_hook_active: false });

let r = gate(STOP);
check("gate: no active loop → allow (no block)", r.status === 0 && !r.stdout.includes("decision"));

writeFileSync(join(dir, "loop_g.json"), JSON.stringify({ id: "loop_g", goal: "g", closed: false, iteration: 1, budget: { max_iterations: 5 } }));
writeFileSync(join(dir, "ACTIVE.json"), JSON.stringify({ loop_id: "loop_g", block_count: 0, max_blocks: 8 }));
r = gate(STOP);
check("gate: open enforced loop → block", r.stdout.includes('"decision"'));

writeFileSync(join(dir, "loop_g.json"), JSON.stringify({ id: "loop_g", goal: "g", closed: true, final_status: "done", budget: { max_iterations: 5 } }));
r = gate(STOP);
check("gate: closed loop → allow + clears ACTIVE", !r.stdout.includes("decision") && !existsSync(join(dir, "ACTIVE.json")));

rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail ? "SELFTEST FAILED" : "SELFTEST PASSED"}`);
process.exit(fail ? 1 : 0);
