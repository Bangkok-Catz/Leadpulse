# LFM3 on the whole deal set, and on prospect fit (2026-11-07)

Model: `LiquidAI/LFM3-1.7B-GGUF` Q4_K_M (package `3793e1e6…`), llama.cpp 0.8.0 on the M1, thinking off.
Laya: Typed Decisions, package `517a8071`, from `2026-10-01-cutoffs.json` or its running server.
Follows `2026-11-07-lfm3-buyer-response.md`, which moved buyer_response to LFM3.

**Decision:** LFM3 now answers the whole deal set (`--deal-reader lfm3`, the worker default).
Laya keeps prospect fit.

## The ten yes/no deal questions

**Method.** Each question has its own prompt, using Laya's final wording from
`laya-questions.json` and its criteria where it has them. The system prompt is
`NOUL_SYSTEM_PROMPT` in `src/utils/lfm3-buyer.ts`. P(yes) is the model's token probability of
every spelling of yes (yes/Yes/YES/true/True) against every spelling of no. The process
mirrors `scripts/tune_laya_cutoffs.py`:
- **Dev:** cut-offs chosen on `laya_buyer_detail.audit.json` (30 replies) by balanced
  accuracy, taking the median of tied cut-offs.
- **Holdout:** `laya_buyer_detail.holdout.json` (30 replies: 22 English, 8 Thai), scored once.

**One method fix, made after the dev dry run and before the holdout.** The first version
counted only lowercase "yes"/"no". Only a median of 15% of the probability landed on those,
because the model also writes "true"/"Yes" and "false"/"No". Counting every spelling raised
that to a median of 0.998. The wording did not change.

**Shipped code = evaluated method.** `scripts/evaluate-lfm3-deal.ts` runs the worker's own
reader (`readDealReply`) and reproduces the scratch run's scores, cut-offs and accuracies
exactly, on both sets. Outputs: `2026-11-07-lfm3-deal-questions.audit.txt` and `.holdout.txt`.

### Holdout

| Question | AUC LFM3 | Laya | Right, EN: LFM3 | Laya | Right, TH: LFM3 | Laya | yes |
|---|---|---|---|---|---|---|---|
| commercial_info_request | **0.95** | 0.75 | **19/22** | 15/22 | **8/8** | 2/8 | 7 |
| next_step_commitment | 0.77 | **0.83** | 18/22 | **19/22** | 6/8 | 6/8 | 4 |
| trial_reported | **0.95** | 0.90 | 20/22 | 20/22 | **7/8** | 5/8 | 10 |
| trial_positive | 1.00 | 0.99 | 21/21 | 21/21 | 7/8 | 7/8 | 3 |
| trial_negative | **1.00** | 0.96 | **21/21** | 17/21 | **8/8** | 2/8 | 3 |
| concern_price | **0.97** | 0.93 | **22/22** | 21/22 | 6/8 | **7/8** | 4 |
| concern_technical | **0.95** | 0.93 | **21/22** | 20/22 | 5/8 | 5/8 | 4 |
| concern_delivery | 0.87 | 0.86 | **20/22** | 18/22 | **8/8** | 7/8 | 4 |
| concern_approval | **0.92** | 0.72 | **20/22** | 19/22 | **8/8** | 3/8 | 4 |
| concern_timing | 0.74 | **0.86** | **20/22** | 19/22 | **7/8** | 4/8 | 5 |
| **All** | | | **202/218** | 189/218 | **70/80** | 48/80 | |

buyer_response on the same run: AUC 0.967 / 0.989 / 1.00, unchanged from the earlier report.

**Caveats**
- **Sample size:** each question has 3–10 yes replies, so gaps of a few points are noise.
  The large gaps (info request, approval, Thai overall) are the ones that carry weight.
- **Labels:** self-assigned drafts.
- **Holdout exposure:** LFM3 had read these holdout replies before, for buyer_response, but
  never these labels.
- **Weaker questions:** commitment and timing. The timing misses ("not this year", "owner
  travelling", "after Songkran") are replies LFM3's buyer_response already reads as deferred.
- **Cut-offs not used in the grade:** they come from 2–5 yes replies per question, so several
  are extreme (0.10, 0.15, 0.90, 0.95). `grade.ts` therefore weighs LFM3's signal-tier answers
  by probability, and sends an answer in the unsure band (0.35–0.65) to Pat.

### Live deals (dry run, nothing saved)

| Deal | Reply (short) | Before (Laya + LFM3 reply type) | After (LFM3) |
|---|---|---|---|
| ADOR | kitchen team chaotic, postpone meeting to next week | to Pat: unsure trial (0.50) and product concern (0.44); −0.31 | **graded B**, −0.15: put it off, timing concern 0.84, no trial |
| ICING Creative | still testing many recipes, will update | to Pat: unsure trial (0.61, 0.50); −0.03 | **graded B**, −0.15: trial reported 1.00, **product concern 0.76 (wrong)**, put it off 0.80 |

Neither tier changes. Both leave Pat's review list, which Laya's unsure trial readings had
put them on. ICING's product-concern reason is a misread: "recipes" in the reply matches the
question's "works in their recipes". Its "put it off" is the known no-commitment weakness.

### Speed

Per reply: median 15 s, up to 50 s. Thai is slowest, because llama.cpp re-reads the whole
prompt for each of the 11 questions on this hybrid model, and the Mac was swapping.
Acceptable for a worker that reads a few new replies a day.

## Prospect fit: Laya stays

**Method.** Run with a scratch script, not shipped:
- Both models got the same production input (`buildLayaProspectFitInput`) and Laya's fit wording.
- LFM3 used the same yes/no counting, with its cut-off chosen on dev by accuracy (0.50).
- Laya was the running server at production `FIT_THRESHOLD` 0.30. Both fit sets helped set
  Laya's wording and threshold, so its numbers are optimistic.
- Name-only accounts were skipped, as in production.

| | Dev (21) | Holdout (23) |
|---|---|---|
| AUC plant-based | 1.00 vs 1.00 | 1.00 vs 1.00 |
| AUC grocery | 0.99 vs 0.99 | 1.00 vs 0.97 |
| AUC bakery | 1.00 vs 0.91 | 1.00 vs 0.98 |
| Correct pick, LFM3 vs Laya | **20/21** vs 18/21 | 20/23 vs **21/23** |

**On 187 live prospects**, LFM3 agreed with Laya's saved pick on 139. In 42 of the 48 it
disagreed on, it said "no fit".
- **Right by the fixture policy:** some of those are importers and distributors (Puratos,
  Tehmag, Atasco), which the policy calls no fit.
- **Plainly wrong, at about 0.00:**
  - "Doughnut house" as a bakery or dessert maker.
  - "Luxury hotel pastry" (JW Marriott, Sofitel, Mandarin Oriental, Grand Hyatt) as a bakery.
  - A "Vegetarian" restaurant as plant-based.
  - Premium supermarkets (Ranch Market, Little Farms, Farmers Market) as grocery.
- Of the 100 prospects LFM3 calls no fit, 91 score below 0.05, so no cut-off fixes this. LFM3
  reads short CRM labels too literally.
