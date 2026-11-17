import { describe, expect, it } from 'vitest';
import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import type { CompanyFit, EvidenceRow } from './account-profile';
import type { EnrichmentProposal } from './proposals';
import { buildLeadBrief, draftRecipient, findDecider, firstName } from './lead-brief';

const today = '2026-11-16'; // a Monday
const company = (over: Partial<Company> = {}) => ({ id: 'a', name: 'Alpha Bakery', status: 'prospect', address: null, website: null, notes: null, ...over } as unknown as Company);
const deal = (over: Partial<Deal> = {}) =>
  ({ id: 'd', company_id: 'a', client: 'Alpha Bakery', stage: 'research', workflow_action: 'outreach', priority: 'medium', followup_date: null, deleted_at: null, park_reason: null, buyer_reply: null, contact_ids: [], ...over } as unknown as Deal);
const person = (id: string, over: Partial<Contact> = {}) =>
  ({ id, company_id: 'a', name: 'Khun May', line: null, phone: null, email: null, job_title: 'Owner', identity_quality: 'named', status: 'uncontacted', ...over } as unknown as Contact);
const shop = (over: Partial<Contact> = {}) => person('shop', { name: 'Alpha - public route', job_title: null, identity_quality: 'company_route', ...over });
const sent = (date: string, over: Partial<Meeting> = {}) =>
  ({ id: `m-${date}`, deal_id: 'd', company_id: 'a', date, type: 'dm', direction: 'outbound', outcome: null, contact_ids: [], ...over } as unknown as Meeting);
const nameSource = (contactId: string, value: string): EvidenceRow => ({
  entity_type: 'contact', entity_id: contactId, field: 'name', value, source_url: 'https://alpha.example/about',
  source_tier: 'own_site', quote: `our founder, ${value}`, recorded_at: '2026-11-10T02:00:00Z',
});
const fit = (noul: number): CompanyFit => ({
  grades: [{ archetype: 'bakery_patisserie_brands', noul }], best: { archetype: 'bakery_patisserie_brands', noul }, fits: noul >= 0.3, judgedAt: '2026-11-01',
} as CompanyFit);
const brief = (over: Partial<Parameters<typeof buildLeadBrief>[0]> = {}) =>
  buildLeadBrief({ deal: deal(), company: company(), contacts: [], meetings: [], today, ...over });

describe('findDecider', () => {
  it('climbs the ladder one fact at a time', () => {
    const c = company();
    const may = person('m');
    expect(findDecider(c, [may], [], [])).toMatchObject({ level: 1, steps: { named: true, sourced: false, channel: false, replied: false }, channel: null });
    expect(findDecider(c, [may], [], [nameSource('m', 'Khun May')])).toMatchObject({ level: 2, source: { source_url: 'https://alpha.example/about' } });
    expect(findDecider(c, [{ ...may, line: '@may' }], [], [nameSource('m', 'Khun May')])).toMatchObject({ level: 3, channel: 'LINE' });
    expect(findDecider(c, [{ ...may, line: '@may', status: 'replied' }], [], [nameSource('m', 'Khun May')])?.level).toBe(4);
    expect(findDecider(c, [may], [sent('2026-11-12', { direction: 'inbound', contact_ids: ['m'] })], [])?.steps.replied).toBe(true);
  });

  it('never treats a shop route, a barista or a renamed contact as the sourced decision maker', () => {
    const c = company();
    expect(findDecider(c, [shop({ line: '@alpha' })], [], [])).toBeNull();
    expect(findDecider(c, [person('b', { name: 'Ben', job_title: 'Barista', phone: '081' })], [], [])).toBeNull();
    // the source supports the name it was saved with, not a name typed over it later
    expect(findDecider(c, [person('m', { name: 'May Wong' })], [], [nameSource('m', 'Khun May')])?.steps.sourced).toBe(false);
    // a source for someone else's name is not this person's
    expect(findDecider(c, [person('m')], [], [nameSource('x', 'Khun May')])?.steps.sourced).toBe(false);
  });

  it("takes Pat's tagged decision maker, and with several the one furthest up the ladder", () => {
    const tagged = person('t', { name: 'Ploy', job_title: 'Pastry lead' });
    expect(findDecider(company({ decision_maker_contact_id: 't' }), [tagged], [], [])?.contact.id).toBe('t');
    const founder = person('f', { name: 'Fah', job_title: 'Founder' });
    const gm = person('g', { name: 'Gun', job_title: 'General Manager', phone: '081' });
    expect(findDecider(company(), [founder, gm], [], [])?.contact.id).toBe('g');
    expect(findDecider(company({ decision_maker_contact_id: 'f' }), [founder, person('g', { name: 'Gun', job_title: 'General Manager' })], [], [])?.contact.id).toBe('f');
  });
});

describe('buildLeadBrief', () => {
  it('is only for open leads', () => {
    expect(brief({ company: company({ status: 'active_customer' }) })).toBeNull();
    expect(brief({ deal: deal({ buyer_reply: 'Send me a sample' }) })).toBeNull();
    expect(brief({ deal: deal({ stage: 'closed_lost' }) })).toBeNull();
    expect(brief({ company: undefined })).toBeNull();
  });

  it('says why they fit in their own words, and says so when nothing is known', () => {
    expect(brief({ company: company({ what_they_make: 'croissants and kouign-amann' }), fit: fit(0.65) })?.fit)
      .toEqual({ label: 'Bakery fit 65%', fits: true, why: 'Makes croissants and kouign-amann' });
    expect(brief({ company: company({ notes: 'City: Bangkok. Why fit: vegan pastry counter. Tier: A' }), fit: fit(0.1) })?.fit)
      .toEqual({ label: 'No fit · best 10%', fits: false, why: 'vegan pastry counter' });
    expect(brief()?.fit).toEqual({ label: 'Not graded yet', fits: null, why: null });
  });

  it('with nothing on file, the step is to find a way in', () => {
    const b = brief();
    expect(b?.advice).toMatchObject({ kind: 'find_way_in', action: 'Find a way in', due: null });
    expect(b?.advice.reason).toContain('nothing to send to yet');
    expect(brief({ company: company({ website: 'alpha.example' }) })?.advice.reason).toContain('contact page');
  });

  it('an owner waiting for Save comes before a message to the shop', () => {
    const proposal = { id: 'p', field: 'decision_maker', status: 'pending', company_id: 'a', value: 'Thrina Low', details: { job_title: 'Founder' }, source_url: 'https://alpha.example/about' } as unknown as EnrichmentProposal;
    const b = brief({ contacts: [shop({ line: '@alpha' })], proposals: [proposal] });
    expect(b?.proposed).toEqual({ id: 'p', name: 'Thrina Low', role: 'Founder', sourceUrl: 'https://alpha.example/about' });
    expect(b?.advice).toMatchObject({ kind: 'decide_owner', action: 'Decide on Thrina Low, Founder' });
    // another account's proposal, or one already decided, is not this lead's
    expect(brief({ proposals: [{ ...proposal, company_id: 'z' }] })?.proposed).toBeNull();
    expect(brief({ proposals: [{ ...proposal, status: 'rejected' }] })?.proposed).toBeNull();
  });

  it('reaches the owner personally when their own channel is on file', () => {
    const b = brief({ contacts: [person('m', { line: '@may' }), shop({ line: '@alpha' })] });
    expect(b?.advice).toEqual({
      kind: 'first_touch', action: 'Send the first message · May · LINE',
      reason: 'May decides and you have their own LINE.', due: null, also: null,
    });
  });

  it('goes through the shop asking for the owner by name, and names the missing fact', () => {
    const b = brief({ contacts: [person('m'), shop({ line: '@alpha' })] });
    expect(b?.advice).toMatchObject({
      kind: 'first_touch', action: 'Send the first message · Shop LINE · ask for Khun May',
      also: "Find May's own LINE, Instagram, WhatsApp or mobile.",
    });
    expect(b?.advice.reason).toContain('ask for them by name');
    const noOwner = brief({ contacts: [shop({ phone: '02 111 2222' })] });
    expect(noOwner?.advice.reason).toContain('ask who decides');
    expect(noOwner?.advice.also).toContain('owner search');
  });

  it('follows the five-touch plan: wait, follow up, then park', () => {
    const contacts = [person('m', { line: '@may' })];
    const waiting = brief({ contacts, meetings: [sent('2026-11-15')] });
    expect(waiting).toMatchObject({ touches: 1, lastTouch: '2026-11-15', advice: { kind: 'wait', action: 'Wait until Tue 17 Nov', due: '2026-11-17' } });
    const due = brief({ contacts, meetings: [sent('2026-11-10')] });
    expect(due?.advice).toMatchObject({ kind: 'follow_up', action: 'Gentle follow-up · May · LINE', due: null });
    const done = brief({ contacts, meetings: ['2026-10-01', '2026-10-03', '2026-10-08', '2026-10-15', '2026-10-22'].map(d => sent(d)) });
    expect(done?.advice).toMatchObject({ kind: 'park', action: 'Park it · back Fri 15 Jan' });
  });
});

describe('draftRecipient', () => {
  it('is a person on the deal, else the decision maker, never a shop route', () => {
    const may = person('m');
    const ben = person('b', { name: 'Ben', job_title: 'Barista' });
    expect(draftRecipient(deal({ contact_ids: ['b'] }), company(), [may, ben])?.id).toBe('b');
    expect(draftRecipient(deal(), company(), [may, ben])?.id).toBe('m');
    expect(draftRecipient(deal({ contact_ids: ['shop'] }), company(), [shop()])).toBeNull();
    expect(draftRecipient(deal(), undefined, [may])).toBeNull();
  });
});

describe('firstName', () => {
  it('drops the courtesy title', () => {
    expect(firstName('Khun May Wong')).toBe('May');
    expect(firstName('Mr. Melvin Neo')).toBe('Melvin');
    expect(firstName('Ratnasingam')).toBe('Ratnasingam');
    expect(firstName(null)).toBe('');
  });
});
