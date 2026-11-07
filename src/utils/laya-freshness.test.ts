// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dealInputSha256, stateInputSha256 } from './laya-freshness';
import { buyerScoreRequest } from './laya-deal-request';
import { buildScoreRequest } from './laya-worker';

const deal = {
  id: 'deal-1',
  product: 'Butter',
  buyer_reply: 'Please send us a quotation for 20 kg — ขอบคุณครับ "today".',
  last_outcome: null,
  stage: 'proposal' as const,
  workflow_action: 'sample' as const,
};

describe('dealInputSha256', () => {
  it('equals the input hash the worker stores for the same deal (Web Crypto vs node:crypto)', async () => {
    // A Thai reply is skipped by the worker, so compare on the English part's request too.
    const english = { ...deal, buyer_reply: 'Please send us a quotation for 20 kg — "today".' };
    expect(await dealInputSha256(english)).toBe(buildScoreRequest(english)!.inputSha256);
  });

  it('changes when the reply changes, so an old judgment reads as stale', async () => {
    const a = await dealInputSha256({ ...deal, buyer_reply: 'Please quote 20 kg.' });
    const b = await dealInputSha256({ ...deal, buyer_reply: 'We chose another supplier.' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("gives the same hash from a reading's scored state, so a Thai reading can be fresh", async () => {
    expect(await stateInputSha256(buyerScoreRequest(deal)!.sent.state)).toBe(await dealInputSha256(deal));
  });

  it('is null without a verbatim reply', async () => {
    expect(await dealInputSha256({ ...deal, buyer_reply: null })).toBeNull();
  });
});
