#!/usr/bin/env node
// loop-ledger Stop-hook gate. Claude Code runs this on every stop attempt.
// It reads the active-loop pointer and decides: allow the stop, or block it
// (force the agent to keep iterating) until the ledger closes the loop.
//
// Output contract (Claude Code Stop hook):
//   exit 0 + no stdout          -> allow stop
//   exit 0 + {"decision":"block","reason":...} -> force the agent to continue
import { load, readActive, writeActive, clearActive } from "./store.js";

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(""); // no piped input
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

const raw = await readStdin();
let input = {};
try { input = JSON.parse(raw || "{}"); } catch { input = {}; }

// 1. recursion guard — a Stop hook is already running
if (input.stop_hook_active === true) process.exit(0);

// 2. nothing is being enforced
const active = readActive();
if (!active) process.exit(0);

// 3. the pointed-at loop is gone — release and allow
const loop = load(active.loop_id);
if (!loop) { clearActive(); process.exit(0); }

// 4. loop finished — release enforcement, allow stop
if (loop.closed) {
  clearActive();
  console.error(`loop-ledger: loop ${loop.id} finished (${loop.final_status}); allowing stop.`);
  process.exit(0);
}

// 5. failsafe — too many blocks without the loop closing; the model may be wedged. Allow stop.
if (active.block_count >= active.max_blocks) {
  clearActive();
  console.error(`loop-ledger: block failsafe hit (${active.max_blocks}) for ${loop.id}; allowing stop — loop may be wedged.`);
  process.exit(0);
}

// 6. loop still open — block the stop and tell the model what to do next
active.block_count += 1;
writeActive(active);
const reason =
  `Loop "${loop.goal}" is still running (iteration ${loop.iteration}/${loop.budget.max_iterations}). ` +
  `Do the next iteration of work, then call loop_tick with the current state. ` +
  `If you believe you're stuck, call loop_tick with the UNCHANGED state — the ledger will stop you as 'stalled'. ` +
  `Do not stop until loop_tick returns should_continue=false.`;
process.stdout.write(JSON.stringify({ decision: "block", reason }));
process.exit(0);
