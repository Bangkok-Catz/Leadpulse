import { describe, expect, it } from 'vitest';
import type { Company, Deal } from '@/types/crm';
import { CLOSED_REASON, closeDownPlan, isClosedDown, reopenStatus } from './closed-down';
import { isOpenLead } from './prospecting';
import { buildAccountStrip } from './accounts-strip';

const company = (over: Partial<Company> = {}) => ({ id: 'a', name: 'Banana Warrior', status: 'prospect', ...over } as unknown as Company);
const deal = (id: string, over: Partial<Deal> = {}) =>
  ({ id, company_id: 'a', client: 'Banana Warrior', stage: 'research', workflow_action: 'outreach', followup_date: '2026-11-20', next_action: 'First message', last_outcome: null, park_reason: null, nudge_stage: null, buyer_reply: null, ...over } as unknown as Deal);

describe('closeDownPlan', () => {
  it('closes the account and parks every open deal with no date to come back on', () => {
    const plan = closeDownPlan(company(), [deal('d1'), deal('d2', { stage: 'contacted', workflow_action: 'reply' })]);
    expect(plan.company).toEqual({ patch: { status: 'closed' }, before: { status: 'prospect' } });
    expect(plan.deals.map(d => d.deal.id)).toEqual(['d1', 'd2']);
    for (const d of plan.deals) {
      expect(d.patch).toMatchObject({ park_reason: CLOSED_REASON, followup_date: null, workflow_action: 'parked' });
    }
  });

  it('leaves won, lost, already parked and other accounts\' deals alone', () => {
    const plan = closeDownPlan(company(), [
      deal('won', { stage: 'closed_won' }), deal('lost', { stage: 'closed_lost' }),
      deal('parked', { park_reason: 'Not now' }), deal('other', { company_id: 'z' }), deal('open'),
    ]);
    expect(plan.deals.map(d => d.deal.id)).toEqual(['open']);
  });

  it('Undo puts back exactly what the deal held', () => {
    const [d] = closeDownPlan(company(), [deal('d1')]).deals;
    expect(Object.keys(d.before).sort()).toEqual(Object.keys(d.patch).sort());
    expect(d.before).toMatchObject({ park_reason: null, followup_date: '2026-11-20', workflow_action: 'outreach' });
  });

  it('a closed customer is closed too', () => {
    expect(closeDownPlan(company({ status: 'active_customer' }), []).company.before).toEqual({ status: 'active_customer' });
  });
});

describe('a closed account leaves the work lists', () => {
  it('is no longer a lead, even with a deal nobody parked', () => {
    expect(isOpenLead(deal('d1'), company(), [])).toBe(true);
    expect(isOpenLead(deal('d1'), company({ status: 'closed' }), [])).toBe(false);
  });

  it('is not counted as a prospect or as missing an owner', () => {
    const strip = buildAccountStrip({ companies: [company(), company({ id: 'b', status: 'closed' })], contacts: [], checkInDue: new Set(), toReview: new Set() });
    expect(strip.counts).toMatchObject({ prospects: 1, no_owner: 1 });
  });
});

describe('reopen', () => {
  it('goes back to a customer if it ever bought, else a prospect', () => {
    expect(reopenStatus(company(), [deal('d1')])).toBe('prospect');
    expect(reopenStatus(company(), [deal('w', { stage: 'closed_won' })])).toBe('active_customer');
    expect(reopenStatus(company(), [deal('w', { stage: 'closed_won', company_id: 'z' })])).toBe('prospect');
  });

  it('isClosedDown reads the status', () => {
    expect(isClosedDown(company({ status: 'closed' }))).toBe(true);
    expect(isClosedDown(company())).toBe(false);
    expect(isClosedDown(null)).toBe(false);
  });
});
