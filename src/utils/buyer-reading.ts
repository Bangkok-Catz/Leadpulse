// ─── Use LFM3's reading of the buyer's reply in Laya's saved judgments ───
// Pure, browser-safe. The Mac worker saves two readings of each reply: Laya's "terminal"
// set (buyer_response plus the trial and concern questions) and LFM3's "buyer" set
// (buyer_response only; lfm3-buyer.ts). LFM3's probabilities rank replies far better
// (holdout AUC 0.97–1.00 vs Laya's 0.87–0.89), so when both readings are of the same
// reply — the same scored state — LFM3's buyer_response replaces Laya's. Everything else in the row, its freshness hash
// included, stays Laya's, so grade.ts and the review list work unchanged.
//
// Since LFM3 reads deals itself (the worker's default deal reader), its rows are whole
// deal-set judgments and pass through untouched; the swap is for Laya's older rows.
//
// Laya never judges a Thai reply (laya-worker.ts skipReason), so LFM3's reading of one has
// no Laya row to join. withReplyOnlyReadings makes it a row of its own ("buyer" set, reply
// type only); grade.ts grades a Thai reply from it and treats it as unjudged otherwise.

import type { LayaJudgmentRow } from '@/lib/crm';
import { BUYER_LABELS, LFM3_MODEL } from './lfm3-buyer';

/** A saved "buyer" set row, as the app reads it. */
export interface BuyerReadingRow {
  deal_id: string;
  scored_state: string;
  status: string;
  /** why LFM3 refused (contact_opt_out, input_too_long); null on a scored row */
  not_scored_code?: string | null;
  answers: Record<string, { probabilities?: Record<string, number> }> | null;
  model_repository: string;
  model_package_sha256?: string;
  scored_at: string;
}

/** The question set of a row that carries LFM3's reading alone (no Laya row for that reply). */
export const REPLY_ONLY_SET = 'buyer';

/** Who read a saved deal row: LFM3 (its own deal-set rows, or a lone reading) or Laya. */
export function readerOf(row: Pick<LayaJudgmentRow, 'question_set' | 'model_repository'>): 'laya' | 'lfm3' {
  return row.question_set === REPLY_ONLY_SET || row.model_repository === LFM3_MODEL.repository ? 'lfm3' : 'laya';
}

/** The refusals the worker saves; any other not_scored row is malformed. */
const REFUSAL_CODES = new Set(['contact_opt_out', 'input_too_long']);

type BuyerResponse = NonNullable<LayaJudgmentRow['answers']>[string];

/** The reading's buyer_response when it is a full distribution over the five labels. */
function buyerResponseOf(reading: BuyerReadingRow): BuyerResponse | null {
  if (reading.status !== 'scored') return null;
  const answer = reading.answers?.buyer_response;
  const p = answer?.probabilities;
  if (!p) return null;
  const values = BUYER_LABELS.map(label => p[label]);
  if (values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) return null;
  if (Math.abs(values.reduce((sum, v) => sum + v, 0) - 1) > 0.002) return null;
  return answer as BuyerResponse;
}

const keyOf = (dealId: string, state: string) => `${dealId}\u0000${state}`;

/**
 * Each scored row with LFM3's buyer_response swapped in where LFM3 read the same reply,
 * and `buyer_reader` naming the model whose reading it now carries (null: Laya's own).
 * The newest valid reading per reply wins. Rows keep their order.
 */
export function withBuyerReadings(rows: LayaJudgmentRow[], readings: BuyerReadingRow[]): LayaJudgmentRow[] {
  const newest = new Map<string, { row: BuyerReadingRow; answer: BuyerResponse }>();
  for (const reading of readings) {
    const answer = buyerResponseOf(reading);
    if (!answer) continue;
    const key = keyOf(reading.deal_id, reading.scored_state);
    const seen = newest.get(key);
    if (!seen || reading.scored_at > seen.row.scored_at) newest.set(key, { row: reading, answer });
  }
  return rows.map(row => {
    // A row LFM3 answered in full already carries its own buyer_response.
    if (row.model_repository === LFM3_MODEL.repository) return { ...row, buyer_reader: row.model_repository };
    const reading = row.status === 'scored' && row.answers && row.scored_state !== undefined
      ? newest.get(keyOf(row.deal_id, row.scored_state))
      : undefined;
    if (!reading) return { ...row, buyer_reader: null };
    return {
      ...row,
      answers: { ...row.answers, buyer_response: reading.answer },
      buyer_reader: reading.row.model_repository,
    };
  });
}

/**
 * The latest row of each deal, with LFM3's reading standing on its own where Laya has no
 * row for the same reply: a Thai reply, or one Laya has not reached yet. Such a reading
 * replaces the deal's Laya row only when it is newer (so it is about a later reply); its
 * input_sha256 is the deal-set hash of the reply it read (`dealSetSha`), so freshness and
 * Pat's decisions match it as they match a Laya row. `rows` are the merged latest rows,
 * one per deal; `readings` are the latest "buyer" rows, scored or refused.
 */
export async function withReplyOnlyReadings(
  rows: LayaJudgmentRow[],
  readings: BuyerReadingRow[],
  dealSetSha: (state: string) => Promise<string>,
): Promise<LayaJudgmentRow[]> {
  const newest = new Map<string, BuyerReadingRow>();
  for (const reading of readings) {
    const seen = newest.get(reading.deal_id);
    if (!seen || reading.scored_at > seen.scored_at) newest.set(reading.deal_id, reading);
  }
  const byDeal = new Map(rows.map(row => [row.deal_id, row]));
  const standalone = new Map<string, LayaJudgmentRow>();
  for (const [dealId, reading] of newest) {
    const laya = byDeal.get(dealId);
    if (laya && (laya.scored_state === reading.scored_state || laya.scored_at >= reading.scored_at)) continue;
    const row = await replyOnlyRow(reading, dealSetSha);
    if (row) standalone.set(dealId, row);
  }
  const out = rows.map(row => standalone.get(row.deal_id) ?? row);
  for (const [dealId, row] of standalone) if (!byDeal.has(dealId)) out.push(row);
  return out;
}

/** One reading as a row of its own, or null when it is malformed. */
async function replyOnlyRow(reading: BuyerReadingRow, dealSetSha: (state: string) => Promise<string>): Promise<LayaJudgmentRow | null> {
  if (typeof reading.scored_state !== 'string' || !reading.scored_state) return null;
  let answers: LayaJudgmentRow['answers'] = null;
  let notScoredCode: string | null = null;
  if (reading.status === 'scored') {
    const answer = buyerResponseOf(reading);
    if (!answer) return null;
    answers = { buyer_response: answer };
  } else if (reading.status === 'not_scored' && reading.not_scored_code && REFUSAL_CODES.has(reading.not_scored_code)) {
    notScoredCode = reading.not_scored_code;
  } else {
    return null;
  }
  return {
    deal_id: reading.deal_id,
    question_set: REPLY_ONLY_SET,
    input_sha256: await dealSetSha(reading.scored_state),
    status: answers ? 'scored' : 'not_scored',
    not_scored_code: notScoredCode,
    answers,
    model_package_sha256: reading.model_package_sha256 ?? '',
    scored_at: reading.scored_at,
    scored_state: reading.scored_state,
    model_repository: reading.model_repository,
    buyer_reader: reading.model_repository,
  };
}
