import { describe, expect, it } from 'vitest';
import type { Company, Contact } from '@/types/crm';
import { buildAccountStrip, ownerFound } from './accounts-strip';

const company = (id: string, status: string, over: Partial<Company> = {}) => ({ id, name: id, status, ...over } as unknown as Company);
const person = (id: string, companyId: string, over: Partial<Contact> = {}) =>
  ({ id, company_id: companyId, name: 'Someone', line: null, phone: null, email: null, job_title: null, identity_quality: 'named', ...over } as unknown as Contact);

describe('owner found', () => {
  it('needs a named owner or decision maker with their own way in', () => {
    const c = company('a', 'prospect');
    expect(ownerFound(c, [person('o', 'a', { job_title: 'Owner', line: '@may' })])).toBe(true);
    expect(ownerFound(c, [person('o', 'a', { job_title: 'Owner' })])).toBe(false);
    expect(ownerFound(c, [person('s', 'a', { job_title: 'Barista', phone: '081' })])).toBe(false);
    expect(ownerFound(company('a', 'prospect', { decision_maker_contact_id: 's' }), [person('s', 'a', { job_title: 'Barista', phone: '081' })])).toBe(true);
    expect(ownerFound(c, [person('r', 'a', { identity_quality: 'company_route', job_title: 'Owner', line: '@shop' } as Partial<Contact>)])).toBe(false);
  });
});

describe('the summary strip', () => {
  it('counts each tile and filters by it', () => {
    const companies = [company('cust1', 'active_customer'), company('cust2', 'active_customer'), company('p1', 'prospect'), company('p2', 'prospect'), company('lost', 'lost')];
    const strip = buildAccountStrip({
      companies,
      contacts: [person('o', 'p1', { job_title: 'Founder', email: 'f@p1.test' })],
      checkInDue: new Set(['cust2', 'p2']),
      toReview: new Set(['lost']),
    });
    expect(strip.counts).toEqual({ checkin: 1, customers: 2, prospects: 2, no_owner: 1, review: 1 });
    expect(strip.ownerFound).toBe(1);
    expect(companies.filter(c => strip.matches('no_owner', c)).map(c => c.id)).toEqual(['p2']);
  });
});
