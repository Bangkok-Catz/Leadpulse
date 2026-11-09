import { describe, expect, it } from 'vitest';
import type { Deal } from '@/types/crm';
import { buildQuickLog, followupPatch, otherKinds, primaryKind } from './quick-log';

const deal: Deal = {
  id: 'deal-1',
  title: 'Butter · ICING Creative',
  stage: 'research',
  product: 'Butter',
  client: 'ICING Creative',
  company_id: 'company-1',
  contact_ids: ['contact-1'],
  value: null,
  priority: 'medium',
  next_action: 'Send samples for testing',
  followup_date: '2026-11-05',
  last_outcome: null,
  nudge_count: 0,
  workflow_action: 'reply',
  nudge_stage: null,
  sample_status: null,
  buyer_reply: 'Can you send a sample?',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const today = '2026-11-09';

describe('the button for a step', () => {
  it('reads the step wording', () => {
    expect(primaryKind('Send samples for testing', deal)).toBe('sample');
    expect(primaryKind('Deliver butter samples', deal)).toBe('sample');
    expect(primaryKind('ส่งตัวอย่างให้เชฟ', deal)).toBe('sample');
    expect(primaryKind('Check sample feedback', deal)).toBe('dm');
    expect(primaryKind('Second follow-up: call เกลอ', deal)).toBe('call');
    expect(primaryKind('Email the price list', deal)).toBe('email');
    expect(primaryKind('Send samples to Sweet & Green', { ...deal, workflow_action: 'reschedule' })).toBe('sample');
    expect(primaryKind('Send samples', { ...deal, workflow_action: 'parked' })).toBe('dm');
    expect(primaryKind('Visit the kitchen', deal)).toBe('visit');
    expect(primaryKind('Check in', null)).toBe('dm');
    expect(primaryKind(null, deal)).toBe('dm');
  });

  it('offers the other ways, with They replied first on a deal and no sample once it is closed', () => {
    expect(otherKinds('sample', deal)).toEqual(['reply', 'dm', 'call', 'no_answer', 'email', 'visit']);
    expect(otherKinds('dm', { ...deal, workflow_action: 'testing' })).toEqual(['reply', 'call', 'no_answer', 'email', 'sample', 'visit']);
    expect(otherKinds('dm', { ...deal, workflow_action: 'parked' })).toEqual(['reply', 'call', 'no_answer', 'email', 'visit']);
    expect(otherKinds('dm', null)).toEqual(['call', 'no_answer', 'email', 'visit']);
  });
});

describe('what a tap saves', () => {
  it('Sample sent moves the deal to Sample (sent) and dates the arrival check', () => {
    const log = buildQuickLog({ kind: 'sample', deal, today });
    expect(log.meeting).toMatchObject({ type: 'sample_sent', direction: 'outbound', deal_id: 'deal-1', company_id: 'company-1', date: today, description: 'Sample sent' });
    expect(log.dealPatch).toMatchObject({ workflow_action: 'sample', sample_status: 'sent', followup_date: '2026-11-12', next_action: 'Check the sample arrived' });
    expect(log.before).toMatchObject({ workflow_action: 'reply', sample_status: null, followup_date: '2026-11-05', next_action: 'Send samples for testing' });
    expect(log.followupDate).toBe('2026-11-12');
  });

  it('a sample from Follow-up moves the deal to Sample; from Testing it stays in Testing', () => {
    expect(buildQuickLog({ kind: 'sample', deal: { ...deal, workflow_action: 'reschedule' }, today }).dealPatch)
      .toMatchObject({ workflow_action: 'sample', sample_status: 'sent', followup_date: '2026-11-12' });
    const testing = buildQuickLog({ kind: 'sample', deal: { ...deal, workflow_action: 'testing' }, today });
    expect(testing.dealPatch).toMatchObject({ workflow_action: 'testing', sample_status: 'sent', followup_date: '2026-11-12', next_action: 'Check the sample arrived' });
    expect(testing.meeting).toMatchObject({ type: 'sample_sent', direction: 'outbound', deal_id: 'deal-1' });
  });

  it('refuses a sample on a closed deal', () => {
    expect(() => buildQuickLog({ kind: 'sample', deal: { ...deal, workflow_action: 'parked' }, today })).toThrow(/closed/);
  });

  it('a call moves the follow-up three days on and keeps the lane', () => {
    const log = buildQuickLog({ kind: 'call', deal, today });
    expect(log.meeting).toMatchObject({ type: 'call', direction: 'outbound', outcome: null, followup_date: '2026-11-12' });
    expect(log.dealPatch).toEqual({ followup_date: '2026-11-12' });
    expect(log.before).toEqual({ followup_date: '2026-11-05' });
  });

  it('a first touch at Reach out moves the deal to Waiting on reply', () => {
    const log = buildQuickLog({ kind: 'dm', deal: { ...deal, workflow_action: 'outreach' }, today });
    expect(log.dealPatch).toMatchObject({ workflow_action: 'reply', followup_date: '2026-11-12' });
    expect(log.dealPatch.last_outcome).toMatch(/Outreach logged/);
  });

  it('no answer is still a touch, marked as no response', () => {
    const log = buildQuickLog({ kind: 'no_answer', deal, today });
    expect(log.meeting).toMatchObject({ type: 'call', outcome: 'no_response', direction: 'outbound', description: 'Called, no answer' });
  });

  it('They replied logs an inbound touch, saves the words and leaves the date', () => {
    const log = buildQuickLog({ kind: 'reply', deal, today, words: '  We can do a tasting on Friday ' });
    expect(log.meeting).toMatchObject({ direction: 'inbound', type: 'dm', followup_date: null });
    expect(log.dealPatch).toEqual({ buyer_reply: 'We can do a tasting on Friday' });
    expect(log.before).toEqual({ buyer_reply: 'Can you send a sample?' });
    expect(log.followupDate).toBeNull();
  });

  it('a check-in on a regular logs the touch only', () => {
    const log = buildQuickLog({ kind: 'dm', companyId: 'company-9', today });
    expect(log.meeting).toMatchObject({ company_id: 'company-9', deal_id: null, type: 'dm', direction: 'outbound' });
    expect(log.dealPatch).toEqual({});
    expect(log.followupDate).toBeNull();
  });

  it('a later follow-up choice is its own patch', () => {
    expect(followupPatch(today, 7)).toEqual({ followup_date: '2026-11-16' });
    expect(followupPatch(today, null)).toEqual({ followup_date: null });
  });
});
