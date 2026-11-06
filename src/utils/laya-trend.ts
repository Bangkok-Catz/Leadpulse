// ─── Trend: this reply against the previous one ───
// Pure. laya_judgments keeps one row per judged reply, so the newest scored row made for
// a DIFFERENT reply is the previous reading. The trend compares only what Laya read in
// the two replies (replyMomentum) — order size and chases are today's facts, not history.

import type { LayaJudgmentRow } from '@/lib/crm';
import { replyMomentum, type DealGrade, type ReplyTrend } from './grade';

/** A change smaller than this reads as steady. */
export const TREND_STEP = 0.05;

/** The newest scored row made for another reply than the current one; `rows` newest first. */
export function previousJudgment(rows: LayaJudgmentRow[], currentSha: string | null): LayaJudgmentRow | null {
  if (!currentSha) return null;
  const current = rows.find(row => row.input_sha256 === currentSha);
  return rows.find(row =>
    row.status === 'scored' && row.input_sha256 !== currentSha && (!current || row.scored_at < current.scored_at)) ?? null;
}

export function replyTrend(
  current: LayaJudgmentRow['answers'] | undefined,
  previous: LayaJudgmentRow['answers'] | undefined,
): ReplyTrend | null {
  const now = replyMomentum(current);
  const before = replyMomentum(previous);
  if (now === null || before === null) return null;
  const delta = Math.round((now - before) * 100) / 100;
  return { direction: delta >= TREND_STEP ? 'up' : delta <= -TREND_STEP ? 'down' : 'steady', delta };
}

/** The grade with its trend, when it has momentum and a previous reply was judged. */
export function withTrend(
  grade: DealGrade,
  current: LayaJudgmentRow | null | undefined,
  /** this deal's scored rows, newest first */
  history: LayaJudgmentRow[],
  currentSha: string | null,
): DealGrade {
  if (grade.momentum === null || !current) return grade;
  const previous = previousJudgment(history, currentSha);
  // Readings by different models (LFM3's vs Laya's own) are not comparable: show no
  // trend rather than one that only reflects the change of reader.
  if (previous && (previous.buyer_reader ?? null) !== (current.buyer_reader ?? null)) return grade;
  const trend = replyTrend(current.answers, previous?.answers);
  return trend ? { ...grade, trend } : grade;
}

/** History rows grouped by deal, keeping the newest-first order. */
export function historyByDeal(history: LayaJudgmentRow[]): Map<string, LayaJudgmentRow[]> {
  const byDeal = new Map<string, LayaJudgmentRow[]>();
  for (const row of history) {
    const rows = byDeal.get(row.deal_id);
    if (rows) rows.push(row); else byDeal.set(row.deal_id, [row]);
  }
  return byDeal;
}
