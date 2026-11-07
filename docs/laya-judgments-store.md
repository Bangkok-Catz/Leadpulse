# Laya judgments store — design note

Status: **table live, worker and app not built.** Applied to the live project on
2026-09-29: `20260929120000_add_laya_judgments.sql` and the follow-up
`20260929130000_laya_judgments_latest_read_only.sql` (tested first on a throwaway local
Postgres). Verified live as the `anon` role: reads work, inserts are denied on the table
and fail on the view. The table is empty until the worker below exists.

## Why

Today Laya only runs when a browser tab calls the Mac (`127.0.0.1:8765`, or the Tailscale
host from the phone). Nothing is saved, so:

- there is no grade while the page is closed, and nothing to sort a pipeline by;
- every viewer re-runs the model;
- the phone needs Tailscale and local-network permission just to see a result.

## Shape

```
Supabase deals / companies
        │  (poll: which subjects have no judgment for their current input?)
        ▼
Laya worker on the Mac ──POST /score──▶ laya_score_server.py (already running; one model load)
        │  writes validated answers or an explicit refusal, with the service-role key
        ▼
public.laya_judgments  (append-only)  ──▶  public.laya_judgments_latest (view)
        │  read-only for the app (anon key)
        ▼
LeadPulse on Vercel / phone: reads rows, checks freshness, grade.ts computes any grade in code
```

The score server stays the only process that touches the model. The worker is a small
client of it: the server's input-budget guard, opt-out gate and answer validator apply to
every saved row for free.

## Table: `public.laya_judgments`

One row per scoring run of one question set against one subject. Never updated.

| Column | Meaning |
|---|---|
| `deal_id` / `company_id` | Exactly one. `buyer` and `terminal` judge a deal; `fit` judges a company. Cascades on delete. |
| `question_set` | A set name from `src/utils/laya-questions.json`. |
| `questions_sha256` | SHA-256 of that set's exact questions JSON. A wording change makes old rows stale. |
| `input_sha256` | SHA-256 of the exact `/score` body (see below). How the app tells fresh from stale. |
| `scored_state` | The state text that was scored — the provenance a reviewer needs. |
| `status` | `scored` (with an `answers` object) or `not_scored` (with `not_scored_code`: `contact_opt_out` or `input_too_long`). |
| `answers` | The worker-validated `answers` object from `/score`, unchanged. |
| `model_*`, `engine` | The model identity from the server's trace. |
| `scored_at` | The server's UTC timestamp. |

Guarantees enforced by the database (tested locally):

- the subject matches the question set; never both, never neither;
- a `scored` row has an answers **object**; a refusal has a known reason and no answers;
- hashes are 64 lowercase hex characters; engine is `cpu_ne` or `cpu_gpu`;
- the same input scored by the same model package is one row (a retried run cannot
  duplicate it); a new model package re-judges;
- `anon` / `authenticated` can **read** but not insert, update or delete. Only the service
  role writes. This differs on purpose from the other tables' "Allow all for anon": a page
  must never be able to forge a model judgment.

`laya_judgments_latest` is the newest row per subject and set (`security_invoker`, so RLS
applies through it).

## Freshness: `input_sha256`

```
input_sha256 = sha256( JSON.stringify({ state, questions }) )   // UTF-8 bytes
```

- **JS:** `JSON.stringify` of the request body the builders already produce.
- **Python:** `json.dumps(body, ensure_ascii=False, separators=(",", ":"))`, UTF-8.

Both were checked to produce identical hashes for all three sets on a state with Thai
text, an em dash, quotes, a backslash and a tab. Key order matters and is preserved on
both sides, since both read the same JSON file.

The app rebuilds the state from the current CRM row with the same builder, hashes it,
and compares it with the latest row:

- **match** → show the saved answers;
- **no row, or different hash** → "not judged for the current text" (never show an old
  answer as if it applied to new text);
- **`not_scored`** → show the refusal (for example "possible no-contact request —
  review manually"), never a grade.

## Worker loop (built 2026-10-01: `scripts/laya-judgment-worker.ts`)

Written in TypeScript so it reuses the app's own builder, question set and answer parser
(`src/utils/laya-worker.ts` holds the tested pure parts). Run it next to the score server:

```bash
node scripts/laya-judgment-worker.ts --dry-run          # score, write nothing (no key needed)
node scripts/laya-judgment-worker.ts                    # one pass, saves rows
node scripts/laya-judgment-worker.ts --watch 300        # a pass every 5 minutes
```

It skips Thai replies (they route to Pat in `grade.ts`), and deals already judged for the same
input and model package. A Typed Decisions pass takes about 7 s per deal for the 11-question
set. Smoke test 2026-10-01 on the 30-reply holdout fixture: 22 English replies scored and
validated, 8 Thai skipped, nothing written. The original design notes follow.

## LFM3 reads the buyer's reply (2026-11-07)

Laya's `buyer_response` was its weakest answer (holdout AUC 0.87–0.89, single pick 11/26).
Liquid AI's LFM3-1.7B ranks the same holdout at 0.97–1.00
(`scripts/eval_results/2026-11-07-lfm3-buyer-response.md`), so it now supplies that answer:

```
worker pass ── Laya part:  "terminal" set → laya_judgments   (unchanged)
            └─ LFM3 part:  "buyer" set    → laya_judgments   (question_set 'buyer')
                 only when a reply has no LFM3 reading: start llama-server, read, stop
app (crm.ts) ── terminal row + buyer row with the same scored_state
                 → LFM3's buyer_response in place of Laya's (buyer-reading.ts)
```

- **No schema change.** `buyer` was already an allowed deal set, and llama.cpp on Metal is
  the existing `cpu_gpu` engine. `model_repository` tells the readers apart; the package
  hash is the GGUF file's SHA-256.
- **Same checks as Laya.** The reading is shaped like a `/score` response and goes through
  `parseLayaScore` and `judgmentRowFromResponse`; opt-outs are refused with Laya's patterns.
- **Freshness is still Laya's.** The swap happens only when both rows scored the same state,
  so the terminal row's `input_sha256` still decides fresh vs stale. With no LFM3 reading
  (model missing, not yet run, failed), the grade uses Laya's own reading as before.
- **Trend** is shown only between two readings by the same reader (`buyer_reader`).
- **Thai** replies (2026-11-07, second change): Laya never reads Thai, so LFM3's reading of a
  Thai reply has no terminal row to join. `withReplyOnlyReadings` makes it a row of its own
  (question set `buyer`), whose `input_sha256` is the deal-set hash of the state it read
  (`stateInputSha256`), so freshness and Pat's decisions match it like a Laya row. `grade.ts`
  grades a Thai reply from that reading alone: the reply type (asked for a next step,
  declined, deferred) plus order size and chases. Laya's trial and concern questions are
  never asked of Thai, so they add nothing, and the grade says so. A Thai reply still goes to
  Pat when LFM3 has not read its current text, refused it (opt-out, too long), or is unsure
  (the same 0.35–0.65 band). On an English reply, LFM3's reading alone is "not judged yet":
  Laya's full answer set is still required. Evidence on Thai is small: 10/13 single picks
  (dev 5/5, holdout 5/8); two of the misses are the known no-commitment → deferred weakness,
  the third sat at P 0.50 and goes to Pat.
- **Memory:** the model is never left loaded (about 1.1 GB on an 8 GB Mac), and the LFM3
  part runs at most once per worker interval, even when Laya's part retries sooner.

Run one part: `--only buyer` or `--only laya`. Overrides: `LFM3_LLAMA_SERVER`,
`LFM3_MODEL_PATH`, `LFM3_PORT` (default 8766). Evaluate: `scripts/evaluate-lfm3-buyer.ts`.

### Original design

`scripts/laya_judgment_worker.py`, run on the Mac next to the score server.

1. Every few minutes, read candidate subjects with the service-role key:
   - **deals:** not deleted, not `closed_won` / `closed_lost`, with a non-empty
     `buyer_reply`. Only verbatim replies are scored; paraphrased notes stay manual, as
     the score card already does.
   - **companies:** prospect-status accounts with a name, industry or tags.
2. Build `{state, questions}` with the same rules as the TypeScript builders, and hash it.
   To keep one source of builder truth, the worker should get states from the TS builder
   (as the Python tests already do through a transpile) rather than re-implementing them.
3. Skip subjects whose latest row already has this `input_sha256` and model package.
4. `POST /score` to `127.0.0.1:8765` one at a time (the server allows one inference at a
   time and answers 503 when busy; back off and retry later).
5. Insert the validated result, or a `not_scored` row for a 422 refusal. Do not insert on
   transport errors or 503 — the next pass retries.

Failure behaviour: log counts only, never CRM text (same rule as the server). A crash
loses nothing; the next pass picks up whatever still lacks a fresh row.

### The service-role key

The worker needs a key that bypasses RLS. It must live **only on the Mac**, outside the
repo and outside anything Vercel reads — for example the macOS Keychain, or a
`chmod 600` file under `~/.config/leadpulse/`. It must never be in `.env.local`,
`NEXT_PUBLIC_*`, or the browser bundle.

## App changes (not built yet)

- `src/lib/layaJudgments.ts`: read `laya_judgments_latest` with the anon client.
- Score card and `/lab` show saved judgments with the freshness rule above; the explicit
  "Run" buttons stay as lab tools.
- `grade.ts` (later): a pure function over saved answers plus deterministic CRM fields.

## Grading signals decided (2026-10-01)

Inputs for `grade.ts`, decided with Pat. Weights and cut-offs are still to be tuned.

- **Order quantity — code, not Laya.** Tiers: small < 5 kg, moderate 5–15 kg, large
  > 15 kg, or none. Read from the buyer's words by a deterministic rule
  (`kilograms_stated` in `scripts/evaluate_laya_quantity.py`; sentences about samples
  are skipped). A Laya Choice scored 12/24 on the tiers; the rule 24/24 on the tier set
  and 29/29 on the independent buyer-detail set. Unreadable phrasing ("a few cases")
  gets no tier rather than a guess.
- **Nudges — code, chases since the buyer's last reply.** More unanswered chases lower
  the closing score. Counted from the interaction log, resetting when the buyer replies,
  so a deal that came back to life is not penalised for earlier silence. The pipeline's
  4/4 badge keeps its current lifetime count (`v0-cumulative-sends`); only grading uses
  the since-last-reply count.
- **Warmth — Laya:** `trial_reported`, `trial_positive`, `trial_negative`.
- **Fall-out reasons — Laya:** `concern_price`, `concern_technical`, `concern_delivery`,
  `concern_approval`, `concern_timing`.
- **Cut:** `current_supplier`, `timeline_stated`.

## Prerequisites

1. ~~`deals.buyer_reply` missing in the live database~~ — applied 2026-09-29
   (`20260923_add_deal_buyer_reply.sql`). Every existing deal has it empty, so the worker
   has nothing to judge until verbatim replies are recorded.
2. Merge `chore/laya-slim-down` (the question file this design keys on).
3. A rotated service-role key stored on the Mac only (see above).

## Open questions

- Poll interval and whether to judge on a schedule at all while the Mac sleeps (rows
  simply go stale until it wakes — acceptable?).
- Retention: rows are small; keep all for audit, or prune superseded rows after N days?
- Should the `terminal` set be renamed `buyer_detail` before rows exist? Renaming later
  means migrating the check constraint and existing rows.
