# LFM3-1.7B as the buyer-reply reader — 2026-11-07

Reproduce: `node --no-warnings scripts/evaluate-lfm3-buyer.ts <fixture>` (needs Homebrew
`llama.cpp` and the model file; writes nothing to Supabase). Outputs:
`2026-11-07-lfm3-buyer-response.dev-verbatim.txt`, `…detail-holdout.txt`.

## Setup

- Model: `LiquidAI/LFM3-1.7B-GGUF` @ `cd0c74c5`, `LFM3-1.7B-Q4_K_M.gguf`
  (SHA-256 `3793e1e6…`, matches the download record), llama.cpp 0.8.0 (b11960), Metal, M1 8 GB.
- Question: the frozen `buyer` set (`buyer_response`, five labels, Laya's wording).
- Input: the same state Laya scores — `We supply … The buyer's latest reply: "…"`.
- Prompt: `BUYER_SYSTEM_PROMPT` in `src/utils/lfm3-buyer.ts`, written once and not tuned on
  any result below. Thinking off.
- Probabilities: each label's exact-token probability after `{"label": "`, renormalised
  over the five labels (labels below 1e-4 are not followed and count as 0). Confidence is
  Laya's (1 − entropy / log 5). Opt-outs are refused by Laya's own patterns before the model runs.

## Results

**Dev, buyer's own words** (`laya_buyer_response.dev.verbatim.json`, the 22 cases with a
verbatim reply; the worker never scores notes):

| | LFM3 (shipped code path) | Laya multilingual, 2026-09-23 `v_verbatim` |
|---|---|---|
| Correct label | **20/22** | 12/22 |
| Thai | **5/5** | 4/5 |
| Opt-outs refused | 4/4 | 4/4 |

That Laya run is the older multilingual model, not the Typed Decisions model live since
2026-10-01, which was not run on this set.

**Live Laya's own holdout** (`laya_buyer_detail.holdout.json`, 26 labelled replies, 8 Thai;
labelled before any inference). Laya numbers from `2026-10-01-cutoffs-report.md`
(Typed Decisions, package `517a8071`). LFM3 scored once with the frozen prompt:

| | LFM3 | Laya (live) |
|---|---|---|
| AUC P(requested_next_step) | **0.967** | 0.869 |
| AUC P(declined) | **0.989** | 0.892 |
| AUC P(deferred) | **1.000** | 0.870 |
| Single pick | 13/26 | 11/26 |
| Thai pick | 5/8 | — (Thai routes to Pat) |

`grade.ts` uses those three probabilities as weights (the 2026-10-01 recommendation), not
the single pick, so the AUCs are what moves the grade.

**Known weakness:** on the holdout LFM3 calls every "no commitment yet" reply *deferred*
(0/10): a buyer waiting on a partner, a head chef or a trip reads to it as "asks to revisit
after a stated time". In the grade that costs about −0.1 × P(deferred) per reply; it never
raises P(requested_next_step) or P(declined). Fixing it means rewording on a dev set and a
fresh holdout — this holdout has now been seen.

An earlier scratch run (JSON-schema output, not the shipped method) scored 31/40 on
`laya_buyer_response.holdout.json`, which holds third-person notes the worker never scores.

## Speed and memory

Model load ~1 s. A sure reply ~1.0–1.5 s, an unsure one up to ~4.4 s: llama.cpp re-reads the
prompt for every probability query on this hybrid model (`cache_n` stays 0, with or without
`--ctx-checkpoints`). About 1.1 GB while loaded; with Laya also loaded, swap went from
2.2 GB to 3.6 GB, so the worker starts it only when a reply has no reading and stops it after.
