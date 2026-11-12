// ─── Accounts: the summary strip ───
// Pure. Five tiles over the account list, each a filter: customers due a check-in, customers,
// prospects (with how many have an owner Pat can reach), prospects with no owner yet, and
// accounts with something to review. "Owner found" follows the reach-the-owner rule: a named
// decision maker (the account's decision maker, or a person whose title says owner, founder,
// GM…) with their own LINE, phone or email. A shop's general channel doesn't count.

import type { Company, Contact } from '../types/crm';
import { isCompanyRoute } from './contact-identity.ts';
import { DECIDER } from './prospecting.ts';

export type AccountFocus = 'checkin' | 'customers' | 'prospects' | 'no_owner' | 'review';

export const FOCUS_LABEL: Record<AccountFocus, string> = {
  checkin: 'Check-in due',
  customers: 'Customers',
  prospects: 'Prospects',
  no_owner: 'No owner yet',
  review: 'To review',
};

const reachable = (c: Contact) => Boolean(c.line?.trim() || c.phone?.trim() || c.email?.trim());

/** The account's owner or decision maker, by name, with a way to reach them personally. */
export function ownerFound(company: Company, contacts: readonly Contact[]): boolean {
  const people = contacts.filter(c => c.company_id === company.id && !isCompanyRoute(c));
  return people.some(c => reachable(c) && (c.id === company.decision_maker_contact_id || DECIDER.test(c.job_title ?? '')));
}

export interface AccountStrip {
  counts: Record<AccountFocus, number>;
  /** prospects with an owner found */
  ownerFound: number;
  /** does this account belong to the tile */
  matches: (focus: AccountFocus, company: Company) => boolean;
}

export function buildAccountStrip(input: {
  companies: readonly Company[];
  contacts: readonly Contact[];
  /** customers whose check-in date has come (utils/followup-policy.ts deriveRetentionDueSignals) */
  checkInDue: ReadonlySet<string>;
  /** accounts with proposals or a logo waiting for Pat */
  toReview: ReadonlySet<string>;
}): AccountStrip {
  const withOwner = new Set<string>();
  for (const company of input.companies) {
    if (company.status === 'prospect' && ownerFound(company, input.contacts)) withOwner.add(company.id);
  }
  const matches = (focus: AccountFocus, company: Company): boolean => {
    switch (focus) {
      case 'checkin': return company.status === 'active_customer' && input.checkInDue.has(company.id);
      case 'customers': return company.status === 'active_customer';
      case 'prospects': return company.status === 'prospect';
      case 'no_owner': return company.status === 'prospect' && !withOwner.has(company.id);
      case 'review': return input.toReview.has(company.id);
    }
  };
  const counts: Record<AccountFocus, number> = { checkin: 0, customers: 0, prospects: 0, no_owner: 0, review: 0 };
  for (const company of input.companies) {
    for (const focus of Object.keys(counts) as AccountFocus[]) if (matches(focus, company)) counts[focus]++;
  }
  return { counts, ownerFound: withOwner.size, matches };
}
