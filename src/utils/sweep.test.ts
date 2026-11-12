import { describe, expect, it } from 'vitest';
import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import { buildTodaysLeads } from './prospecting';
import { buildSweepPile, noteFacts, sourceLabel, sweepUpdate } from './sweep';

const today = '2026-11-09';
const company = (id: string, over: Partial<Company> = {}) => ({ id, name: id.toUpperCase(), status: 'prospect', address: null, lead_source: null, ...over } as unknown as Company);
const deal = (id: string, companyId: string, over: Partial<Deal> = {}) =>
  ({ id, company_id: companyId, client: companyId, stage: 'research', workflow_action: 'outreach', priority: 'medium', followup_date: null, park_reason: null, buyer_reply: null, kept_at: null, last_outcome: null, created_at: '2026-09-02T00:00:00Z', updated_at: 'v1', ...over } as unknown as Deal);
const line = (companyId: string) =>
  ({ id: `r-${companyId}`, company_id: companyId, name: `${companyId} shop`, line: `@${companyId}`, phone: null, email: null, job_title: null, identity_quality: 'company_route' } as unknown as Contact);
const sent = (dealId: string, date: string) =>
  ({ id: `m-${dealId}`, deal_id: dealId, date, type: 'dm', direction: 'outbound', outcome: null } as unknown as Meeting);

describe('the Reach-out pile', () => {
  const companies = ['a', 'b', 'c', 'touched', 'kept', 'parked', 'cust'].map(id => company(id));
  companies.find(c => c.id === 'cust')!.status = 'active_customer';
  const deals = companies.map(c => deal(`d-${c.id}`, c.id));
  deals.find(d => d.id === 'd-kept')!.kept_at = '2026-11-01';
  deals.find(d => d.id === 'd-parked')!.park_reason = 'Not now';
  deals.find(d => d.id === 'd-c')!.priority = 'high';
  const meetings = [sent('d-touched', '2026-11-02')];
  const contacts = [line('a')];

  it('holds open leads never contacted and not kept, best fit first', () => {
    const pile = buildSweepPile({ deals, companies, contacts, meetings, fits: new Map([['b', 0.8], ['a', 0.4]]) });
    expect(pile.map(card => card.deal.id)).toEqual(['d-b', 'd-a', 'd-c']);
    expect(pile[1].route?.label).toBe('Shop LINE · ask for the owner');
    expect(pile[0].route).toBeNull();
    expect(pile[0].fit).toBe(0.8);
  });

  it('puts high priority first among leads Laya has not graded', () => {
    const pile = buildSweepPile({ deals, companies, contacts, meetings, fits: new Map() });
    expect(pile.map(card => card.deal.id)).toEqual(['d-c', 'd-a', 'd-b']);
  });
});

describe('what a choice saves', () => {
  const d = deal('d-a', 'a', { kept_at: null, followup_date: null, last_outcome: 'Imported' });

  it('Keep stamps the day and nothing else; Undo clears it', () => {
    expect(sweepUpdate(d, 'keep', today)).toEqual({ patch: { kept_at: today }, before: { kept_at: null } });
  });

  it('Not now parks the lead for 60 days, Not a fit parks it for good', () => {
    const notNow = sweepUpdate(d, 'not_now', today);
    expect(notNow.patch).toMatchObject({ workflow_action: 'parked', park_reason: 'Not now', followup_date: '2027-01-08' });
    expect(notNow.before).toMatchObject({ workflow_action: 'outreach', park_reason: null, followup_date: null, last_outcome: 'Imported' });
    const notFit = sweepUpdate(d, 'not_fit', today);
    expect(notFit.patch).toMatchObject({ workflow_action: 'parked', park_reason: 'Not a fit', followup_date: null });
  });
});

describe('Today\'s leads after a sweep', () => {
  it('takes the leads Pat kept before better-graded ones', () => {
    const companies = ['best', 'kept'].map(id => company(id));
    const deals = [deal('d-best', 'best'), deal('d-kept', 'kept', { kept_at: '2026-11-08' })];
    const leads = buildTodaysLeads({
      deals, companies, contacts: companies.map(c => line(c.id)), meetings: [], fits: new Map([['best', 0.9], ['kept', 0.2]]), today, limit: 1,
    });
    expect(leads.today.map(l => l.deal.id)).toEqual(['d-kept']);
  });
});

describe('sourceLabel', () => {
  it('says where a lead came from in a few words', () => {
    expect(sourceLabel('VG Saveur Thailand partner research 2026-09-02')).toBe('Partner research · Sep');
    expect(sourceLabel('Thailand fine dining restaurants CSV provided by Pat; audited 2026-09-14 Asia/Bangkok')).toBe('Fine dining list · Sep');
    expect(sourceLabel('HappyCow Bangkok 2026-09-16')).toBe('HappyCow · Sep');
    expect(sourceLabel('Hermes discovery', '2026-10-03T00:00:00Z')).toBe('Hermes search · Oct');
    expect(sourceLabel('Official homepage/contact page 2026-07-21')).toBe('Own website · Jul');
    expect(sourceLabel(null, null)).toBeNull();
  });
});

describe('noteFacts', () => {
  it('reads where, what kind and why from each research format', () => {
    expect(noteFacts('Source: https://www.baankerdbkk.com/\nCity/market: Bangkok\nType: Conscious grocer + cafe\nWhy fit: Farm-to-table organic retail + brunch café; multi-location\nSource priority: High\nResearch-only; no outreach performed 2026-09-02.'))
      .toEqual({ place: 'Bangkok', type: 'Conscious grocer + cafe', why: 'Farm-to-table organic retail + brunch café; multi-location', rest: null });
    expect(noteFacts('Source: Thailand fine dining restaurants CSV. City: Chiang Mai. Source description: Michelin-starred European fine dining in Chiang Mai, serving seasonal tasting menus. Official website spot-check succeeded. No buyer verified.'))
      .toMatchObject({ place: 'Chiang Mai', why: 'Michelin-starred European fine dining in Chiang Mai, serving seasonal tasting menus' });
    expect(noteFacts('[EXPORT ENRICHMENT 2026-09-02]\nSource company name: Healthy Options (Philippines)\nCountry/market: Philippines; city: Quezon City (HQ Libis)\nType: retailer (+ own import)\nWhy fit: Already sells chilled Melt Organic plant butter.'))
      .toMatchObject({ place: 'Philippines · Quezon City (HQ Libis)', type: 'retailer (+ own import)', why: 'Already sells chilled Melt Organic plant butter' });
    expect(noteFacts('Lead scoped 2026-07-17: five-star riverside hotel. Fit: dairy-free butter test for pastry and afternoon tea. | Sources: https://www.peninsula.com/en/bangkok'))
      .toMatchObject({ place: null, why: 'dairy-free butter test for pastry and afternoon tea' });
  });

  it('falls back to the note without its research bookkeeping', () => {
    expect(noteFacts('Met at the vegan fair.\nSource: https://example.com\nResearch-only; no outreach.')).toEqual({ place: null, type: null, why: null, rest: 'Met at the vegan fair.' });
    expect(noteFacts(null)).toEqual({ place: null, type: null, why: null, rest: null });
  });
});
