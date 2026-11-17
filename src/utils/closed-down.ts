// ─── Closed down: a business that no longer exists ───
// Pure. "Closed down" is an account status (migration 20261117120000). Setting it also parks
// the account's open deals with the same reason and no follow-up date, so nothing about the
// account comes back on its own. It is different from "Not a fit" (wrong buyer, still trading)
// and "Not now" (right buyer, wrong time): a closed business is never worth another look
// unless it reopens, and then Reopen puts it back as a prospect or a customer.

import type { Company, CompanyStatus, Deal } from '../types/crm';
import { buildCloseUpdate } from './deal-close.ts';

export const CLOSED_REASON = 'Closed down';

export const isClosedDown = (company: Pick<Company, 'status'> | null | undefined): boolean => company?.status === 'closed';

const isOpen = (deal: Deal) => deal.stage !== 'closed_won' && deal.stage !== 'closed_lost' && !deal.park_reason;

export interface CloseDownPlan {
  company: { patch: Pick<Company, 'status'>; before: Pick<Company, 'status'> };
  /** every open deal of the account, parked; `before` is what Undo puts back */
  deals: { deal: Deal; patch: Partial<Deal>; before: Partial<Deal> }[];
}

/** What marking an account closed saves, and what Undo restores. */
export function closeDownPlan(company: Company, deals: readonly Deal[]): CloseDownPlan {
  const plan: CloseDownPlan = { company: { patch: { status: 'closed' }, before: { status: company.status } }, deals: [] };
  for (const deal of deals) {
    if (deal.company_id !== company.id || !isOpen(deal)) continue;
    const { updates } = buildCloseUpdate(deal, { kind: 'park', park_reason: CLOSED_REASON, followup_date: null });
    const before: Partial<Deal> = {};
    for (const key of Object.keys(updates) as (keyof Deal)[]) (before as Record<string, unknown>)[key] = deal[key] ?? null;
    plan.deals.push({ deal, patch: updates, before });
  }
  return plan;
}

/** The status a reopened account goes back to: a customer if it ever bought, else a prospect.
 *  Its parked deals stay parked; Pat reopens the ones worth chasing. */
export function reopenStatus(company: Pick<Company, 'id'>, deals: readonly Pick<Deal, 'company_id' | 'stage'>[]): CompanyStatus {
  return deals.some(d => d.company_id === company.id && d.stage === 'closed_won') ? 'active_customer' : 'prospect';
}
