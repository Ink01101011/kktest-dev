// Pure loop-state machine. No I/O, no MCP SDK — so it's trivially testable.
// This module is the "source of truth" the model cannot rationalize past:
// it decides should_continue from budget + stall-hash + exit predicate only.

import { createHash } from "node:crypto";

// Hash the "did anything change" content so we can detect spinning.
export function hashState(input) {
  return createHash("sha256").update(String(input ?? "")).digest("hex").slice(0, 16);
}

export function newLoop(id, cfg, now) {
  const exit = cfg.exit || {};
  const budget = cfg.budget || {};
  return {
    id,
    goal: cfg.goal,
    exit: {
      mode: exit.mode || "manual", // manual | target | dry
      target_value: exit.target_value ?? null,
      direction: exit.direction || "increase", // increase | decrease
      dry_rounds: exit.dry_rounds ?? 2,
    },
    budget: {
      max_iterations: budget.max_iterations, // HARD backstop, always required
      max_tokens: budget.max_tokens ?? null,
      max_wall_clock_seconds: budget.max_wall_clock_seconds ?? null,
    },
    patience: cfg.patience ?? 2, // consecutive identical-state ticks ⇒ stalled
    created_at: now,
    closed_at: null,
    // mutable counters:
    iteration: 0,
    last_hash: null,
    stall_count: 0,
    best_progress: null,
    dry_count: 0,
    tokens_spent: 0,
    closed: false,
    final_status: null,
    history: [],
  };
}

function targetReached(exit, progress) {
  return exit.direction === "decrease"
    ? progress <= exit.target_value
    : progress >= exit.target_value;
}

function stop(loop, status, reason, now, metrics) {
  loop.closed = true;
  loop.final_status = status;
  loop.closed_at = now;
  return { should_continue: false, status, reason, metrics };
}

// Apply one tick. Mutates `loop` counters and returns a decision.
// Precedence is deliberate:
//   done > hard budget > target(success) > stall(FAILURE) > dry(success) > continue
export function applyTick(loop, tick, now) {
  if (loop.closed) {
    return {
      should_continue: false,
      status: loop.final_status || "closed",
      reason: "loop already closed — start a new one",
      metrics: null,
    };
  }

  loop.iteration += 1;
  if (typeof tick.tokens_spent === "number") loop.tokens_spent = tick.tokens_spent;

  // --- stall tracking (always on, the anti-spin guard) ---
  const hash = hashState(tick.state);
  if (loop.last_hash !== null && hash === loop.last_hash) loop.stall_count += 1;
  else loop.stall_count = 0;
  loop.last_hash = hash;

  // --- progress / dry tracking ---
  const progress = typeof tick.progress === "number" ? tick.progress : null;
  let improved = false;
  if (progress !== null) {
    if (loop.best_progress === null || progress > loop.best_progress) {
      improved = true;
      loop.best_progress = progress;
    }
    loop.dry_count = improved ? 0 : loop.dry_count + 1;
  }

  const elapsed = (now - loop.created_at) / 1000;
  const metrics = {
    iteration: loop.iteration,
    stall_count: loop.stall_count,
    dry_count: loop.dry_count,
    best_progress: loop.best_progress,
    tokens_spent: loop.tokens_spent,
    elapsed_seconds: Math.round(elapsed),
    budget_left: {
      iterations: loop.budget.max_iterations - loop.iteration,
      tokens: loop.budget.max_tokens != null ? loop.budget.max_tokens - loop.tokens_spent : null,
      seconds: loop.budget.max_wall_clock_seconds != null
        ? Math.round(loop.budget.max_wall_clock_seconds - elapsed)
        : null,
    },
  };

  let decision;
  // 1. caller asserts the goal is met by ground truth
  if (tick.done === true) {
    decision = stop(loop, "done", "caller asserted goal complete", now, metrics);
  }
  // 2. hard budget caps — fire regardless of state, the runaway backstop
  else if (loop.iteration >= loop.budget.max_iterations) {
    decision = stop(loop, "budget_exhausted",
      `iteration cap reached (${loop.budget.max_iterations}) — STOP and report partial progress`, now, metrics);
  } else if (loop.budget.max_tokens != null && loop.tokens_spent >= loop.budget.max_tokens) {
    decision = stop(loop, "budget_exhausted",
      `token budget reached (${loop.budget.max_tokens})`, now, metrics);
  } else if (loop.budget.max_wall_clock_seconds != null && elapsed >= loop.budget.max_wall_clock_seconds) {
    decision = stop(loop, "budget_exhausted",
      `wall-clock budget reached (${loop.budget.max_wall_clock_seconds}s)`, now, metrics);
  }
  // 3. target metric crossed — success exit
  else if (loop.exit.mode === "target" && progress !== null && targetReached(loop.exit, progress)) {
    decision = stop(loop, "target_reached",
      `progress ${progress} reached target ${loop.exit.target_value}`, now, metrics);
  }
  // 4. identical state repeated — FAILURE exit: you are spinning, escalate, don't retry the same thing
  else if (loop.stall_count >= loop.patience) {
    decision = stop(loop, "stalled",
      `state unchanged for ${loop.stall_count + 1} consecutive ticks — you are spinning. ` +
      `STOP: escalate or change approach, do NOT retry the same action`, now, metrics);
  }
  // 5. no NEW progress for K rounds — SUCCESS exit: nothing left to find (loop-until-dry)
  else if (loop.exit.mode === "dry" && loop.dry_count >= loop.exit.dry_rounds) {
    decision = stop(loop, "converged",
      `no new progress for ${loop.dry_count} consecutive rounds — converged`, now, metrics);
  }
  // 6. keep going
  else {
    decision = { should_continue: true, status: "continue", reason: "progress ok, continue", metrics };
  }

  loop.history.push({ iteration: loop.iteration, hash, progress, status: decision.status });
  return decision;
}
