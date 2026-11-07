import { describe, expect, it } from 'vitest';
import type { LayaJudgmentRow } from '@/lib/crm';
import LAYA_CUTOFFS from './laya-cutoffs.json';
import type { DealGrade } from './grade';
import { replyMomentum } from './grade';
import { historyByDeal, previousJudgment, replyTrend, withTrend } from './laya-trend';

function row(sha: string, scoredAt: string, pRequest: number, over: Partial<LayaJudgmentRow> = {}): LayaJudgmentRow {
  const answers: LayaJudgmentRow['answers'] = {
    buyer_response: { probabilities: { requested_next_step: pRequest, declined: 0.02, deferred: 0.02, unclear: 0.1, no_commitment: 0.1 } },
  };
  for (const id of Object.keys(LAYA_CUTOFFS.deal)) if (id !== 'buyer_response') answers![id] = { noul: 0.05 };
  return { deal_id: 'd1', question_set: 'terminal', input_sha256: sha, status: 'scored', not_scored_code: null, answers, model_package_sha256: 'a'.repeat(64), scored_at: scoredAt, ...over };
}

const grade: DealGrade = { status: 'graded', baseTier: 'B', tier: 'B', suggestedTier: 'B', momentum: 0.2, reasons: [], review: [], quantity: 'none' };

describe('withTrend across readers', () => {
  it("shows no trend when LFM3 read this reply and only Laya read the previous one", () => {
    const current = row('new', '2026-11-07T00:00:00Z', 0.9, { buyer_reader: 'LiquidAI/LFM3-1.7B-GGUF' });
    const history = [current, row('old', '2026-10-01T00:00:00Z', 0.1, { buyer_reader: null })];
    expect(withTrend(grade, current, history, 'new').trend).toBeUndefined();
  });

  it('compares two readings by the same reader', () => {
    const current = row('new', '2026-11-07T00:00:00Z', 0.9, { buyer_reader: 'LiquidAI/LFM3-1.7B-GGUF' });
    const history = [current, row('old', '2026-10-01T00:00:00Z', 0.1, { buyer_reader: 'LiquidAI/LFM3-1.7B-GGUF' })];
    expect(withTrend(grade, current, history, 'new').trend?.direction).toBe('up');
  });
});

describe('replyMomentum', () => {
  it('sums only what Laya read in the reply, and needs a complete answer set', () => {
    expect(replyMomentum(row('x', '2026-10-01T00:00:00Z', 0.9).answers)).toBeGreaterThan(replyMomentum(row('x', '2026-10-01T00:00:00Z', 0.1).answers)!);
    expect(replyMomentum({ buyer_response: { probabilities: { requested_next_step: 0.9 } } })).toBeNull();
    expect(replyMomentum(null)).toBeNull();
  });
});

describe('previousJudgment', () => {
  const rows = [row('new', '2026-10-02T00:00:00Z', 0.9), row('new', '2026-10-01T12:00:00Z', 0.9), row('old', '2026-09-20T00:00:00Z', 0.2), row('older', '2026-09-01T00:00:00Z', 0.5)];

  it('is the newest scored row made for another reply', () => {
    expect(previousJudgment(rows, 'new')!.input_sha256).toBe('old');
  });

  it('is null without a current hash or an earlier reply', () => {
    expect(previousJudgment(rows, null)).toBeNull();
    expect(previousJudgment([rows[0]], 'new')).toBeNull();
  });

  it('never picks a row scored after the current one', () => {
    // The buyer's text was edited back to an older reply: its row is current, the later one is not "previous".
    expect(previousJudgment(rows, 'old')!.input_sha256).toBe('older');
  });
});

describe('replyTrend', () => {
  it('reads up, down and steady from the change in reply momentum', () => {
    const answers = (p: number) => row('x', '2026-10-01T00:00:00Z', p).answers;
    expect(replyTrend(answers(0.9), answers(0.2))).toMatchObject({ direction: 'up' });
    expect(replyTrend(answers(0.2), answers(0.9))).toMatchObject({ direction: 'down' });
    expect(replyTrend(answers(0.5), answers(0.45))).toMatchObject({ direction: 'steady' });
    expect(replyTrend(answers(0.5), null)).toBeNull();
  });
});

describe('withTrend', () => {
  const current = row('new', '2026-10-02T00:00:00Z', 0.9);
  const history = [current, row('old', '2026-09-20T00:00:00Z', 0.2)];

  it('adds the trend to a grade that has momentum', () => {
    expect(withTrend(grade, current, history, 'new').trend).toEqual({ direction: 'up', delta: 0.21 });
  });

  it('leaves the grade alone without momentum, a current row or a previous reply', () => {
    expect(withTrend({ ...grade, momentum: null }, current, history, 'new').trend).toBeUndefined();
    expect(withTrend(grade, null, history, 'new').trend).toBeUndefined();
    expect(withTrend(grade, current, [current], 'new').trend).toBeUndefined();
  });
});

describe('historyByDeal', () => {
  it('groups rows by deal and keeps their order', () => {
    const rows = [row('a', '2026-10-02T00:00:00Z', 0.5), row('b', '2026-10-01T00:00:00Z', 0.5, { deal_id: 'd2' }), row('c', '2026-09-30T00:00:00Z', 0.5)];
    const grouped = historyByDeal(rows);
    expect(grouped.get('d1')!.map(r => r.input_sha256)).toEqual(['a', 'c']);
    expect(grouped.get('d2')).toHaveLength(1);
  });
});

describe('withTrend between readers of the trial and concern questions', () => {
  const LFM3 = 'LiquidAI/LFM3-1.7B-GGUF';
  const lfm3Row = (sha: string, at: string, p: number) => row(sha, at, p, { model_repository: LFM3, buyer_reader: LFM3 });

  it('shows no trend from a Laya row to an LFM3 row', () => {
    const current = lfm3Row('new', '2026-11-08T00:00:00Z', 0.9);
    expect(withTrend(grade, current, [current, row('old', '2026-09-20T00:00:00Z', 0.2, { buyer_reader: LFM3 })], 'new').trend).toBeUndefined();
  });

  it('shows the trend between two LFM3 rows', () => {
    const current = lfm3Row('new', '2026-11-08T00:00:00Z', 0.9);
    expect(withTrend(grade, current, [current, lfm3Row('old', '2026-11-01T00:00:00Z', 0.2)], 'new').trend?.direction).toBe('up');
  });
});
