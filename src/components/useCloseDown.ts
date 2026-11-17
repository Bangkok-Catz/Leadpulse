'use client';

// ─── Closed down / Reopen: the saving half of utils/closed-down.ts ───
// The account is saved first: if that fails nothing else is touched. Each change is logged
// with what Undo restores, so Recent changes can put the account and every deal back.

import { useState } from 'react';
import type { Company } from '@/types/crm';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import * as crm from '@/lib/crm';
import { closeDownPlan, reopenStatus } from '@/utils/closed-down';

export function useCloseDown() {
  const { deals = [], refresh, logActivity } = useCrm();
  const { addToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const closeDown = async (company: Company): Promise<boolean> => {
    const plan = closeDownPlan(company, deals);
    setBusy(company.id);
    try {
      await crm.updateCompany(company.id, plan.company.patch);
    } catch (err) {
      addToast(`Could not mark ${company.name} closed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      setBusy(null);
      return false;
    }
    logActivity({
      type: 'edit', entity: 'company', entityId: company.id,
      label: 'Closed down', description: `${company.name}: the business has closed`, undoPayload: plan.company.before,
    });
    let parked = 0;
    for (const { deal, patch, before } of plan.deals) {
      try {
        await crm.updateDealIfUnchanged(deal.id, deal.updated_at, patch);
        logActivity({ type: 'edit', entity: 'deal', entityId: deal.id, label: 'Lead parked', description: `${company.name}: closed down`, undoPayload: before });
        parked++;
      } catch {
        // The account is closed either way, so the deal is off every list; say it stayed open.
      }
    }
    await refresh();
    const left = plan.deals.length - parked;
    addToast(left > 0
      ? `${company.name} closed down, but ${left} ${left === 1 ? 'deal' : 'deals'} could not be parked. Open the account to park ${left === 1 ? 'it' : 'them'}.`
      : `${company.name}: closed down${parked ? ` · ${parked} ${parked === 1 ? 'deal' : 'deals'} parked` : ''}`,
    left > 0 ? 'error' : undefined);
    setBusy(null);
    return true;
  };

  const reopen = async (company: Company): Promise<boolean> => {
    const status = reopenStatus(company, deals);
    setBusy(company.id);
    try {
      await crm.updateCompany(company.id, { status });
      logActivity({ type: 'edit', entity: 'company', entityId: company.id, label: 'Reopened', description: `${company.name}: trading again`, undoPayload: { status: company.status } });
      await refresh();
      addToast(`${company.name}: reopened. Its deals stay parked until you reopen them.`);
      return true;
    } catch (err) {
      addToast(`Could not reopen ${company.name}: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };

  return { closeDown, reopen, busy };
}
