# Live LLM verification — measured 2026-11-16

Scope: the **provider layer** used by every AI feature. Per-feature mapping is
being produced by the full AI audit. No key material is printed in this file.

## Method

- `.env.local` key presence only (values never printed).
- Model-list endpoints (read-only, no generation spend).
- One-token generation pings with the literal prompt "Reply with one word:
  ready" — no user data, no production data, no writes.
- Timings are wall-clock from the request start; a single sample each, not a
  load test.

## Results

| Provider | Endpoint check | Configured model present | Generation ping |
|---|---|---|---|
| NVIDIA NIM (`NVIDIA_API_KEY`) | `/v1/models` → **200**, 33 models, 1186 ms | `nvidia/nemotron-3.5-bolt-e4b` **yes**; `nvidia/nemotron-3-ultra-550b-a55b` **yes**; `nvidia/nemotron-3-super-120b-a12b` **no** (retired id, already removed from the chain) | **200**, **1095 ms**, returned model `nvidia/nemotron-3.5-bolt-e4b`, real content "ready" |
| Groq (`GROQ_API_KEY`) | `/v1/models` → **200**, 11 models, 1696 ms | `openai/gpt-oss-120b` **yes** | **200**, **977 ms**, returned model `openai/gpt-oss-120b`, `content` 5 chars + `reasoning` 54 chars |
| Pollinations public fallback (no key) | `/models` → **200**, 2058 ms | `openai-fast` **yes**; `openai` **no**; `gpt-oss` **no** | **200**, **7850 ms**, returned "ready" |

## Conclusions — stated precisely

1. **A real LLM is connected and generating tokens.** Two keyed providers
   (NVIDIA NIM, Groq) and one public endpoint responded with real completions
   from the exact model ids the app is configured to use. This is proof of
   connectivity, not of model quality.
2. **The default model is current-generation by id** (`nemotron-3.5-bolt-e4b`)
   and the quality hedge (`nemotron-3-ultra-550b-a55b`) still exists in the
   live catalog. The retired `super-120b` id is correctly absent from the code.
3. **"Super fast" is only partly true.** Measured: NIM ~1.1 s, Groq ~1.0 s,
   public fallback ~7.9 s. The public fallback is **not fast**; it is a
   last resort, not a performance tier.
4. **The public fallback has two dead model ids.** `callPublicFrontierLLM`
   tries `openai` and `gpt-oss` before `openai-fast`; the live model list
   contains only `openai-fast`. The first two attempts waste latency on every
   degraded turn. This is a concrete defect to fix.
5. **Newer catalog entries exist** (`nemotron-3.5-lightning-30b-a3b`,
   `nemotron-3.5-super-vl-120b-a12b`, `nemotron-3-nano-omni-30b-a3b-reasoning`).
   Their presence does not make them better for this workload; they are
   candidates for a measured A/B test, not automatic replacements.
6. **"Fully trained", "latest", "super intelligent" are marketing claims.**
   This repository contains no benchmark scores, training-cutoff data, eval
   harness results or freshness verification. I can prove the model id exists
   and generates tokens today. I **cannot** verify those adjectives, and I
   will not claim them. If you want that claim made defensible, the next step
   is a small eval suite (quality + latency + cost) run against the candidate
   models — that produces evidence instead of adjectives.

## Consequence for "every AI feature"

The provider layer is shared, so this verifies that **when an AI feature
actually calls the model chain, it reaches a real LLM**. It does **not** prove
that every feature calls the chain at all — some features may be heuristic,
cached or hardcoded. That per-feature classification is the other half of the
audit and is still running.
