import { describe, expect, it } from 'vitest';
import type { LayaJudgmentRow } from '@/lib/crm';
import { withBuyerReadings, type BuyerReadingRow } from './buyer-reading';
import { gradeDeal } from './grade';
import type { Deal } from '@/types/crm';
import LAYA_CUTOFFS from './laya-cutoffs.json';

const STATE = 'We supply Butter to this account. The buyer\'s latest reply: "Please send a quote for 20 kg."';
const LFM3 = 'LiquidAI/LFM3-1.7B-GGUF';

function layaRow(over: Partial<LayaJudgmentRow> = {}): LayaJudgmentRow {
  const answers: LayaJudgmentRow['answers'] = {
    // Laya misreads the request as no commitment
    buyer_response: { probabilities: { unclear: 0.1, no_commitment: 0.6, declined: 0.1, deferred: 0.1, requested_next_step: 0.1 } },
  };
  for (const id of Object.keys(LAYA_CUTOFFS.deal)) if (id !== 'buyer_response') answers![id] = { noul: 0.05 };
  return {
    deal_id: 'd1', question_set: 'terminal', input_sha256: 'a'.repeat(64), status: 'scored', not_scored_code: null,
    answers, model_package_sha256: 'b'.repeat(64), scored_at: '2026-11-07T10:00:00Z', scored_state: STATE, ...over,
  };
}

function reading(pRequest: number, over: Partial<BuyerReadingRow> = {}): BuyerReadingRow {
  const rest = (1 - pRequest) / 4;
  return {
    deal_id: 'd1', scored_state: STATE, status: 'scored', model_repository: LFM3, scored_at: '2026-11-07T10:05:00Z',
    answers: { buyer_response: { probabilities: { unclear: rest, no_commitment: rest, declined: rest, deferred: rest, requested_next_step: pRequest } } },
    ...over,
  };
}

describe('withBuyerReadings', () => {
  it("swaps in LFM3's buyer_response for the same reply and names the reader", () => {
    const [row] = withBuyerReadings([layaRow()], [reading(0.92)]);
    expect(row.answers!.buyer_response.probabilities!.requested_next_step).toBe(0.92);
    expect(row.buyer_reader).toBe(LFM3);
    // everything else stays Laya's
    expect(row.input_sha256).toBe('a'.repeat(64));
    expect(row.answers!.concern_price).toEqual({ noul: 0.05 });
  });

  it("keeps Laya's own reading when LFM3 read a different reply or another deal", () => {
    expect(withBuyerReadings([layaRow()], [reading(0.9, { scored_state: 'an older reply' })])[0].buyer_reader).toBeNull();
    expect(withBuyerReadings([layaRow()], [reading(0.9, { deal_id: 'd2' })])[0].buyer_reader).toBeNull();
    expect(withBuyerReadings([layaRow()], [])[0].answers!.buyer_response.probabilities!.no_commitment).toBe(0.6);
  });

  it('ignores a refusal or a malformed reading', () => {
    const malformed = reading(0.9);
    malformed.answers!.buyer_response.probabilities!.declined = 0.5; // no longer sums to 1
    expect(withBuyerReadings([layaRow()], [reading(0.9, { status: 'not_scored', answers: null }), malformed])[0].buyer_reader).toBeNull();
  });

  it('uses the newest reading of a reply', () => {
    const [row] = withBuyerReadings([layaRow()], [reading(0.6, { scored_at: '2026-11-07T10:01:00Z' }), reading(0.95, { scored_at: '2026-11-08T09:00:00Z' })]);
    expect(row.answers!.buyer_response.probabilities!.requested_next_step).toBe(0.95);
  });

  it('leaves refused Laya rows alone', () => {
    const refused = layaRow({ status: 'not_scored', not_scored_code: 'contact_opt_out', answers: null });
    expect(withBuyerReadings([refused], [reading(0.9)])[0]).toEqual({ ...refused, buyer_reader: null });
  });

  it('changes the grade the way the better reading says', () => {
    const deal = {
      id: 'd1', stage: 'proposal', workflow_action: 'sample', buyer_reply: 'Please send a quote for 20 kg.', product: 'Butter',
    } as unknown as Deal;
    const judgment = (row: LayaJudgmentRow) => ({ status: row.status, answers: row.answers, fresh: true });
    const before = gradeDeal({ deal, judgment: judgment(layaRow()), chasesSinceReply: 0 });
    const after = gradeDeal({ deal, judgment: judgment(withBuyerReadings([layaRow()], [reading(0.92)])[0]), chasesSinceReply: 0 });
    expect(after.pRequestedNextStep).toBe(0.92);
    expect(after.momentum!).toBeGreaterThan(before.momentum!);
  });
});
