// ─── Use LFM3's reading of the buyer's reply in Laya's saved judgments ───
// Pure, browser-safe. The Mac worker saves two readings of each reply: Laya's "terminal"
// set (buyer_response plus the trial and concern questions) and LFM3's "buyer" set
// (buyer_response only; lfm3-buyer.ts). LFM3's probabilities rank replies far better
// (holdout AUC 0.97–1.00 vs Laya's 0.87–0.89), so when both readings are of the same
// reply — the same scored state — LFM3's buyer_response replaces Laya's. Everything else in the row, its freshness hash
// included, stays Laya's, so grade.ts and the review list work unchanged.

import type { LayaJudgmentRow } from '@/lib/crm';
import { BUYER_LABELS } from './lfm3-buyer';

/** A saved "buyer" set row, as the app reads it. */
export interface BuyerReadingRow {
  deal_id: string;
  scored_state: string;
  status: string;
  answers: Record<string, { probabilities?: Record<string, number> }> | null;
  model_repository: string;
  scored_at: string;
}

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
