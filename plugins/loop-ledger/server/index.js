#!/usr/bin/env node
// loop-ledger — zero-dependency MCP stdio server.
// Implements the MCP stdio transport (newline-delimited JSON-RPC 2.0) by hand so
// the plugin runs straight from a clone with no `npm install`. The loop state
// machine lives in ledger.js (pure) + store.js (persistence). gate.mjs is the
// Stop-hook enforcer. Protocol channel = stdout; all logging goes to stderr.

import { newLoop, applyTick } from "./ledger.js";
import { LEDGER_DIR, load, save, genId, sweep, readActive, writeActive, clearActive } from "./store.js";

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }], structuredContent: obj });
const fail = (msg) => ({ content: [{ type: "text", text: `error: ${msg}` }], isError: true });

const releaseIfClosed = (loop) => {
  if (!loop.closed) return;
  const active = readActive();
  if (active && active.loop_id === loop.id) clearActive();
};

// ---- tool registry: each tool carries its own JSON Schema + handler ----
const TOOLS = [
  {
    name: "loop_start",
    description:
      "Begin a guarded loop and get a loop_id. Call BEFORE any repeating/self-paced process " +
      "(retry, improve-until-done, find-until-dry). max_iterations is a required hard backstop. " +
      "Set enforce:true to make the Stop hook refuse to stop until the loop closes.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "what this loop is trying to achieve" },
        max_iterations: { type: "integer", minimum: 1, description: "HARD cap — loop is forced to stop after this many ticks" },
        exit_mode: { type: "string", enum: ["manual", "target", "dry"], default: "manual",
          description: "manual: only done stops it; target: stop when progress crosses target_value; dry: stop after dry_rounds with no new progress" },
        target_value: { type: "number", description: "for exit_mode=target" },
        direction: { type: "string", enum: ["increase", "decrease"], default: "increase" },
        dry_rounds: { type: "integer", minimum: 1, default: 2 },
        patience: { type: "integer", minimum: 1, default: 2, description: "stop as STALLED after this many consecutive identical-state ticks" },
        max_tokens: { type: "integer", minimum: 1 },
        max_wall_clock_seconds: { type: "integer", minimum: 1 },
        enforce: { type: "boolean", default: false, description: "arm the Stop hook so the session cannot stop until the loop closes" },
      },
      required: ["goal", "max_iterations"],
    },
    handler: (a) => {
      const id = genId();
      const loop = newLoop(id, {
        goal: a.goal,
        exit: { mode: a.exit_mode ?? "manual", target_value: a.target_value, direction: a.direction ?? "increase", dry_rounds: a.dry_rounds ?? 2 },
        budget: { max_iterations: a.max_iterations, max_tokens: a.max_tokens, max_wall_clock_seconds: a.max_wall_clock_seconds },
        patience: a.patience ?? 2,
      }, Date.now());
      save(loop);
      if (a.enforce) writeActive({ loop_id: id, block_count: 0, max_blocks: a.max_iterations + 3 });
      sweep();
      return ok({ loop_id: id, goal: loop.goal, exit: loop.exit, budget: loop.budget, patience: loop.patience, enforced: !!a.enforce });
    },
  },
  {
    name: "loop_tick",
    description:
      "Call ONCE per iteration, AFTER doing the work, to ask whether to continue. Obey should_continue: " +
      "if false, stop. status=stalled means you are spinning — escalate, do not retry.",
    inputSchema: {
      type: "object",
      properties: {
        loop_id: { type: "string" },
        state: { type: "string", description: "content representing 'did anything change' — diff, error text, remaining file set. Same kind every tick; identical ⇒ stall." },
        progress: { type: "number", description: "cumulative progress metric (tests passing, bugs found). Required for target/dry exit." },
        tokens_spent: { type: "number" },
        done: { type: "boolean", description: "true ONLY when ground truth confirms the goal is met" },
        note: { type: "string" },
      },
      required: ["loop_id", "state"],
    },
    handler: (a) => {
      const loop = load(a.loop_id);
      if (!loop) return fail(`unknown loop_id ${a.loop_id}`);
      const decision = applyTick(loop, { state: a.state, progress: a.progress, tokens_spent: a.tokens_spent, done: a.done }, Date.now());
      save(loop);
      releaseIfClosed(loop);
      return ok(decision);
    },
  },
  {
    name: "loop_status",
    description: "Inspect a loop's counters and history without advancing it.",
    inputSchema: { type: "object", properties: { loop_id: { type: "string" } }, required: ["loop_id"] },
    handler: (a) => {
      const loop = load(a.loop_id);
      if (!loop) return fail(`unknown loop_id ${a.loop_id}`);
      return ok({
        loop_id: loop.id, goal: loop.goal, closed: loop.closed, final_status: loop.final_status,
        iteration: loop.iteration, stall_count: loop.stall_count, dry_count: loop.dry_count,
        best_progress: loop.best_progress, tokens_spent: loop.tokens_spent, budget: loop.budget,
        history: loop.history.slice(-10),
      });
    },
  },
  {
    name: "loop_end",
    description: "Mark a loop closed (finished or abandoned out-of-band). Releases Stop-hook enforcement.",
    inputSchema: { type: "object", properties: { loop_id: { type: "string" }, reason: { type: "string" } }, required: ["loop_id"] },
    handler: (a) => {
      const loop = load(a.loop_id);
      if (!loop) return fail(`unknown loop_id ${a.loop_id}`);
      loop.closed = true;
      loop.final_status = loop.final_status || "ended";
      loop.closed_at = Date.now();
      save(loop);
      releaseIfClosed(loop);
      return ok({ loop_id: loop.id, final_status: loop.final_status, reason: a.reason ?? null });
    },
  },
  {
    name: "loop_gc",
    description: "Delete closed loops past TTL and any loop past max-age. Runs automatically on start and on loop_start too.",
    inputSchema: { type: "object", properties: {} },
    handler: () => ok({ deleted: sweep() }),
  },
];

// ---- minimal JSON-RPC 2.0 over stdio ----
const send = (id, result, error) => {
  const msg = error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(msg) + "\n");
};

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return send(id, {
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "loop-ledger", version: "0.1.0" },
    });
  }
  if (method === "tools/list") {
    return send(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return send(id, null, { code: -32602, message: `unknown tool: ${params?.name}` });
    let result;
    try { result = tool.handler(params?.arguments || {}); }
    catch (e) { result = fail(String(e?.message || e)); }
    return send(id, result);
  }
  if (method === "ping") return send(id, {});
  if (id === undefined) return; // notification (e.g. notifications/initialized) — no reply
  return send(id, null, { code: -32601, message: `method not found: ${method}` });
}

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
process.stdin.on("end", () => process.exit(0));

sweep();
console.error("loop-ledger MCP server (zero-dep) on stdio; ledger dir:", LEDGER_DIR);
