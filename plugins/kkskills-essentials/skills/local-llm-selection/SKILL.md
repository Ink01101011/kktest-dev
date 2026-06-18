---
name: local-llm-selection
description: "Use this skill when deciding whether to run an LLM locally (Ollama, llama.cpp, vLLM) vs a hosted API, which local model/quantization fits your hardware, or whether to fine-tune (e.g. QLoRA).
  Triggers include: 'Ollama', 'local model', 'run it on my GPU', 'which model', 'quantization', 'Q4/Q5/Q8', 'VRAM', 'QLoRA', 'fine-tune', 'self-host LLM', 'local vs API cost', 'offline dev model'.
  Also use when sizing a model against available VRAM or estimating local-vs-hosted cost trade-offs.
  Do NOT use for prompt engineering or for picking between hosted-only models on quality alone (no local/hardware dimension)."
version: "0.1.0"
updated: "2026-06-19"
---

# Reference — Local LLM Selection

## Overview

Running a model locally trades **recurring API cost and data egress** for **upfront complexity, fixed
hardware limits, and (usually) lower quality per parameter**. The decision is rarely "local is cheaper"
in isolation — it's whether local clears your quality bar *and* the operational overhead is worth the
savings at your volume. Often the right answer is **hosted for production, local for offline/dev**.

## When to Use

- ✅ Choosing local vs hosted for a workload.
- ✅ Sizing a model + quantization against your VRAM.
- ✅ Weighing fine-tuning (QLoRA) vs prompting/RAG.
- ✅ Setting up an offline/dev model path alongside a hosted production path.
- ❌ Pure prompt design, or hosted-vs-hosted quality picks with no hardware angle.

## Process / Steps

### Step 1 — Decide local vs hosted first

| Favor **local** when | Favor **hosted** when |
|---|---|
| Data can't leave the machine (privacy/compliance) | You need top-tier quality / long context |
| High, steady volume where API cost dominates | Spiky/low volume — pay-per-call is cheaper than idle GPU |
| Offline / air-gapped / dev iteration | Small team; ops complexity isn't worth it |
| Latency from a local model is acceptable | You'd otherwise babysit GPUs, updates, scaling |

Be honest about the savings vs complexity: if self-hosting saves a little but adds real ops burden, it's
usually a **reject** for production — keep hosted, use local only for offline/dev. (Verify the cost math
with real numbers — [[api-cost-probing]].)

### Step 2 — Size the model to your VRAM

Rough rule for weights in VRAM: **params × bytes-per-weight**, plus headroom for KV cache/context.

| Quantization | ~bytes/param | 7–8B model | Notes |
|---|---|---|---|
| FP16 | 2.0 | ~14–16 GB | Full quality, heavy |
| Q8 | ~1.0 | ~8 GB | Near-lossless |
| Q5_K_M | ~0.65 | ~5–6 GB | Good balance |
| Q4_K_M | ~0.5 | ~4–5 GB | Common default; small quality hit |

- ☐ Leave headroom (context/KV cache grows with sequence length) — don't fill VRAM to the brim.
- ☐ Bigger model at lower quant usually beats a smaller model at high quant — but test on *your* task.
- ☐ A coding task wants a code-tuned model (e.g. a Qwen-Coder family) over a general chat model of the
  same size.

### Step 3 — Prompt/RAG before fine-tune

- ☐ Try prompting + retrieval first — cheaper, no training pipeline, easy to change.
- ☐ Fine-tune (QLoRA) only when you need a consistent style/format the base model won't hold, or to bake
  in domain behavior. QLoRA = train low-rank adapters on a quantized base → fits on modest GPUs.
- ☐ Keep an eval set; measure the fine-tune against the prompted baseline before adopting it.

### Step 4 — Wire local as an env-gated path

- ☐ Make the provider swappable (a `provider`/`model` config), so local vs hosted is a setting, not a
  rewrite. See [[reference-clean-architecture]] (ports/adapters).
- ☐ Gate local behind an env flag (`DEV_OFFLINE=1` → Ollama) so production stays on the hosted path.
- ☐ Pin model + runtime versions for reproducibility.

## Rules & Constraints

- ALWAYS: decide local-vs-hosted on quality bar + volume + ops cost — not on "local is free".
- ALWAYS: size the model+quant to VRAM with headroom for context.
- ALWAYS: try prompt/RAG before committing to fine-tuning.
- ALWAYS: keep the provider swappable and gate local behind an env flag.
- NEVER: assume local matches a frontier hosted model's quality at the same task.
- NEVER: adopt a fine-tune without an eval against the prompted baseline.
- NEVER: fill VRAM to capacity and ignore KV-cache/context growth.

## Examples

**Scenario:** Considering Ollama to cut LLM bill on a multi-stage pipeline.
**Right:** Run the cost math (hosted per-stage tiering vs local GPU amortized). If local's saving is
modest but adds serving/ops complexity, **keep hosted for production** and use a local `DEV_OFFLINE`
model for iterating without spending API credits.

**Scenario:** Coding assistant on a 12 GB GPU.
**Right:** A code-tuned ~7B model at Q4_K_M/Q5_K_M (~5 GB weights) leaves room for context. Prefer the
code-specialized model over a general 7B at the same quant.

**Scenario:** Want consistent JSON output the base model keeps breaking.
**Right:** First try a strict prompt + schema/structured output. Only if that's unreliable, QLoRA-tune
on examples — and gate it behind an eval that beats the prompted baseline.

## Changelog

- 0.1.0 (2026-06-19) — initial version; local-vs-hosted decision, VRAM/quant sizing, prompt-before-finetune, env-gated provider swap. Source: "Ollama LLM models" session.
