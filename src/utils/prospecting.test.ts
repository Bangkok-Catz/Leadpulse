import { describe, expect, it } from 'vitest';
import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import { afterTouch, bestRoute, buildTodaysLeads, nextDue, touchLabel, touchTitle } from './prospecting';

const today = '2026-11-06'; // a Friday
const company = (id: string, over: Partial<Company> = {}) => ({ id, name: id.toUpperCase(), status: 'prospect', address: null, ...over } as unknown as Company);
const deal = (id: string, companyId: string, over: Partial<Deal> = {}) =>
  ({ id, company_id: companyId, client: companyId, stage: 'research', workflow_action: 'outreach', priority: 'medium', followup_date: null, deleted_at: null, park_reason: null, buyer_reply: null, ...over } as unknown as Deal);
const contact = (id: string, companyId: string, over: Partial<Contact> = {}) =>
  ({ id, company_id: companyId, name: 'Someone', line: null, phone: null, email: null, job_title: null, identity_quality: 'named', ...over } as unknown as Contact);
const route = (companyId: string, over: Partial<Contact> = {}) => contact(`r-${companyId}`, companyId, { name: `${companyId} - public route`, identity_quality: 'company_route', ...over });
const sent = (dealId: string, date: string, over: Partial<Meeting> = {}) =>
  ({ id: `m-${dealId}-${date}`, deal_id: dealId, date, type: 'dm', direction: 'outbound', outcome: null, ...over } as unknown as Meeting);

describe('bestRoute', () => {
  it('reaches the owner personally first, then the shop asking for the owner by name, then a visit', () => {
    const c = company('a', { address: 'Ari, Bangkok' });
    const staff = contact('s', 'a', { name: 'Ben', job_title: 'Barista', phone: '081' });
    const owner = contact('o', 'a', { name: 'Khun May', job_title: 'Owner' });
    expect(bestRoute(c, [staff, owner, route('a', { line: '@a' })])).toMatchObject({ kind: 'owner', type: 'call', label: 'Ben · phone' });
    expect(bestRoute(c, [{ ...owner, line: '@may' }, staff])).toMatchObject({ kind: 'owner', type: 'dm', label: 'May · LINE' });
    expect(bestRoute(c, [owner, route('a', { line: '@a' })])).toMatchObject({ kind: 'shop', type: 'dm', label: 'Shop LINE · ask for Khun May' });
    expect(bestRoute(c, [route('a', { phone: '02' })])).toMatchObject({ kind: 'shop', type: 'call', label: 'Shop phone · ask for the owner' });
    expect(bestRoute(c, [owner])).toMatchObject({ kind: 'visit', type: 'meeting', contact: null, label: 'Visit · ask for Khun May' });
    expect(bestRoute(company('b'), [])).toBeNull();
  });
});

describe('touch plan', () => {
  it('spaces touches 2, 5, 7 and 7 days apart, and a later date Pat set wins', () => {
    expect(nextDue(0, null, null, today)).toBe(today);
    expect(nextDue(1, '2026-11-02', null, today)).toBe('2026-11-04');
    expect(nextDue(2, '2026-11-02', null, today)).toBe('2026-11-07');
    expect(nextDue(1, '2026-11-02', '2026-11-20', today)).toBe('2026-11-20');
  });

  it('labels each touch and what the deal says next', () => {
    const r = { kind: 'shop' as const, type: 'dm' as const, contact: null, label: 'Shop LINE · ask for the owner' };
    expect(touchLabel(1, r)).toBe('Touch 1 of 5 · first message');
    expect(touchLabel(1, { ...r, type: 'call' })).toBe('Touch 1 of 5 · call');
    expect(touchLabel(1, { ...r, kind: 'visit', type: 'meeting' })).toBe('Touch 1 of 5 · drop by with a sample');
    expect(touchLabel(6, r)).toBe('No reply after 5 touches');
    const lead = { next: 1, route: r } as Parameters<typeof afterTouch>[0];
    expect(touchTitle(lead)).toBe('Touch 1 of 5 · first message (Shop LINE)');
    expect(afterTouch(lead, today)).toEqual({ followup_date: '2026-11-08', next_action: 'Touch 2 of 5 · gentle follow-up' });
    expect(afterTouch({ ...lead, next: 5 }, today)).toEqual({ followup_date: '2026-11-13', next_action: 'No reply after 5 touches: Not now?' });
  });
});

describe('buildTodaysLeads', () => {
  const companies = ['hi', 'mid', 'low', 'chase', 'later', 'replied', 'cust', 'none', 'parked'].map(id => company(id));
  companies.find(c => c.id === 'cust')!.status = 'active_customer';
  const contacts = companies.filter(c => c.id !== 'none').map(c => route(c.id, { line: `@${c.id}` }));
  const deals = companies.map(c => deal(`d-${c.id}`, c.id));
  deals.find(d => d.id === 'd-chase')!.workflow_action = 'reply';
  deals.find(d => d.id === 'd-later')!.workflow_action = 'reply';
  deals.find(d => d.id === 'd-parked')!.park_reason = 'Not now';
  const meetings = [
    sent('d-chase', '2026-11-02'),
    sent('d-later', '2026-11-05'),
    sent('d-replied', '2026-11-01'),
    sent('d-replied', '2026-11-03', { direction: 'inbound' }),
  ];
  const fits = new Map([['hi', 0.81], ['mid', 0.7], ['low', 0.2], ['chase', 0.5]]);

  it('puts due follow-ups first, then new leads by fit; keeps replied, customers and parked out', () => {
    const out = buildTodaysLeads({ deals, companies, contacts, meetings, fits, today, limit: 3 });
    expect(out.today.map(l => l.company.id)).toEqual(['chase', 'hi', 'mid']);
    // A backlog of follow-ups still leaves room for two new leads a day.
    const chased = ['a1', 'a2', 'a3', 'a4'].map(id => company(id));
    const backlog = buildTodaysLeads({
      deals: [...deals, ...chased.map(c => deal(`d-${c.id}`, c.id, { workflow_action: 'reply' }))],
      companies: [...companies, ...chased],
      contacts: [...contacts, ...chased.map(c => route(c.id, { line: '@x' }))],
      meetings: [...meetings, ...chased.map(c => sent(`d-${c.id}`, '2026-10-01'))],
      fits, today,
    });
    expect(backlog.today.map(l => l.stage)).toEqual(['attempting', 'attempting', 'attempting', 'new', 'new']);
    expect(backlog.today.slice(3).map(l => l.company.id)).toEqual(['hi', 'mid']);
    expect(out.today[0]).toMatchObject({ stage: 'attempting', touches: 1, next: 2, due: '2026-11-04' });
    expect(out.more.map(l => l.company.id)).toEqual(['low']);
    expect(out.waiting.map(w => w.company.id)).toEqual(['none']);
    expect(out.fresh).toBe(4); // hi, mid, low, none
    // Every open lead is listed here so This week's follow-up lists can leave it out, even one
    // not due today ("later") or with no way in ("none").
    expect([...out.dealIds].sort()).toEqual(['d-chase', 'd-hi', 'd-later', 'd-low', 'd-mid', 'd-none']);
  });

  it('after five touches the lead is due for "Not now"', () => {
    const five = ['2026-10-01', '2026-10-03', '2026-10-08', '2026-10-15', '2026-10-22'].map(d => sent('d-hi', d));
    const out = buildTodaysLeads({ deals: [deals[0]], companies, contacts, meetings: five, fits, today });
    expect(out.today[0]).toMatchObject({ touches: 5, next: 6, due: '2026-10-29' });
  });
});
