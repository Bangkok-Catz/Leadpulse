'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeftRight, ChevronDown, Circle, CircleDot, Copy, Loader2 } from 'lucide-react';
import type { Company, CompanyStatus, Contact } from '@/types/crm';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import CompanyLogo from '@/components/CompanyLogo';
import * as crm from '@/lib/crm';
import {
  findDuplicatePairs,
  historyByCompany,
  historyLabels,
  historyOf,
  mergeSummary,
  reasonLabel,
  suggestedKeep,
  websiteDomain,
  type AccountHistory,
  type DuplicatePair,
} from '@/utils/company-duplicates';

const STATUS_SHORT: Record<CompanyStatus, string> = {
  prospect: 'Prospect',
  active_customer: 'Customer',
  inactive: 'Inactive',
  lost: 'Lost',
  closed: 'Closed',
};
const FIRST_SHOWN = 3;

const button = 'inline-flex items-center gap-1 rounded-lg border border-clay-hairline bg-white px-2.5 py-1.5 text-xs font-medium text-clay-ink disabled:opacity-60 dark:bg-clay-card';
const primary = 'inline-flex items-center gap-1 rounded-lg bg-clay-ink px-2.5 py-1.5 text-xs font-medium text-clay-canvas disabled:opacity-60';
const ghost = 'rounded-lg px-2 py-1.5 text-xs font-medium text-clay-muted disabled:opacity-60';

/** "Customer · 8 orders · 1 deal · annam-group.com" */
function metaLine(company: Company, history: AccountHistory): string {
  return [STATUS_SHORT[company.status], ...historyLabels(history).slice(0, 3), websiteDomain(company.website)].filter(Boolean).join(' · ');
}

interface DuplicateReviewProps {
  companies: Company[];
  contacts: Contact[];
  onOpenCompany: (id: string) => void;
}

/**
 * Possible duplicates on the Accounts page: pairs that look like one business entered twice,
 * each with Merge, Branch of and Not a duplicate. Shown only once the duplicates migration is
 * in (its dismissals table loads).
 */
export default function DuplicateReview({ companies, contacts, onOpenCompany }: DuplicateReviewProps) {
  const { deals = [], meetings = [], accountEvents = [] } = useCrm();
  const [dismissed, setDismissed] = useState<Set<string> | null>(null);
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    crm.getDuplicateDismissals()
      .then((keys) => { if (!cancelled) setDismissed(keys); })
      .catch(() => { if (!cancelled) setDismissed(null); });
    return () => { cancelled = true; };
  }, []);

  const pairs = useMemo(
    () => (dismissed ? findDuplicatePairs(companies, contacts, dismissed) : []),
    [companies, contacts, dismissed],
  );
  const history = useMemo(() => historyByCompany(contacts, deals, meetings, accountEvents), [contacts, deals, meetings, accountEvents]);

  if (pairs.length === 0) return null;
  const shown = showAll ? pairs : pairs.slice(0, FIRST_SHOWN);

  const setPairDismissed = (key: string, value: boolean) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      if (value) next.add(key); else next.delete(key);
      return next;
    });

  return (
    <section aria-labelledby="possible-duplicates" className="mb-4 rounded-lg border border-clay-hairline bg-white dark:bg-clay-card">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm">
        <span id="possible-duplicates" className="flex items-center gap-2 font-medium text-clay-ink">
          <Copy className="h-4 w-4 text-clay-muted" aria-hidden="true" />
          Possible duplicates <span className="font-normal text-clay-muted">· {pairs.length}</span>
        </span>
        <ChevronDown className={clsx('h-4 w-4 text-clay-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {shown.map((pair) => (
            <PairCard key={pair.key} pair={pair} history={history} onOpenCompany={onOpenCompany} onDismissed={setPairDismissed} />
          ))}
          {pairs.length > FIRST_SHOWN && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full py-1 text-center text-xs font-medium text-clay-muted">
              {showAll ? 'Show fewer' : `Show ${pairs.length - FIRST_SHOWN} more`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

type Step = 'idle' | 'merge' | 'branch';

function PairCard({ pair, history, onOpenCompany, onDismissed }: {
  pair: DuplicatePair<Company>;
  history: Map<string, AccountHistory>;
  onOpenCompany: (id: string) => void;
  onDismissed: (key: string, dismissed: boolean) => void;
}) {
  const { refresh, logActivity, undoActivity } = useCrm();
  const { addToast } = useToast();
  const { a, b } = pair;
  const [step, setStep] = useState<Step>('idle');
  const [keepId, setKeepId] = useState(() => suggestedKeep(a, b, history).id);
  const [parentId, setParentId] = useState(() => pair.likelyParentId ?? suggestedKeep(a, b, history).id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keep = keepId === a.id ? a : b;
  const other = keepId === a.id ? b : a;
  const parent = parentId === a.id ? a : b;
  const branch = parentId === a.id ? b : a;

  const undoToast = (message: string, activityId: string, undone: string) =>
    addToast(message, 'success', {
      label: 'Undo',
      onClick: () => {
        void undoActivity(activityId).then((ok) => addToast(ok ? undone : 'Could not undo that change', ok ? 'success' : 'error'));
      },
    });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      // Supabase errors are plain objects with a message.
      setError((err as { message?: string } | null)?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const merge = () => run(async () => {
    const result = await crm.mergeCompanies(keep.id, other.id);
    const moved = historyLabels(historyOf(history, other.id));
    const activityId = logActivity({
      type: 'merge',
      entity: 'company',
      entityId: keep.id,
      label: `Merged account · ${other.name} into ${keep.name}`,
      description: moved.length ? `${moved.join(', ')} moved` : undefined,
      undoPayload: { merge_id: result.merge_id },
    });
    await refresh();
    undoToast(`Merged into ${keep.name}`, activityId, 'Merge undone');
  });

  const saveBranch = () => run(async () => {
    await crm.updateCompany(branch.id, { parent_company_id: parent.id });
    const activityId = logActivity({
      type: 'edit',
      entity: 'company',
      entityId: branch.id,
      label: `Marked as a branch · ${branch.name}`,
      description: `Branch of ${parent.name}`,
      undoPayload: { parent_company_id: branch.parent_company_id ?? null },
    });
    await refresh();
    undoToast(`Saved as a branch of ${parent.name}`, activityId, 'Branch removed');
  });

  const notDuplicate = () => run(async () => {
    await crm.dismissDuplicate(a.id, b.id);
    onDismissed(pair.key, true);
    addToast('This pair won’t be suggested again', 'success', {
      label: 'Undo',
      onClick: () => {
        crm.undismissDuplicate(a.id, b.id)
          .then(() => onDismissed(pair.key, false))
          .catch(() => addToast('Could not undo that change', 'error'));
      },
    });
  });

  const cancel = () => { setStep('idle'); setError(null); };

  return (
    <div className="rounded-lg border border-clay-hairline p-3">
      {step === 'merge' ? (
        <>
          <p className="mb-1.5 text-xs font-medium text-clay-muted">Keep which account?</p>
          <div role="radiogroup" aria-label="Account to keep" className="space-y-1.5">
            {[a, b].map((company) => {
              const selected = company.id === keepId;
              return (
                <button
                  key={company.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setKeepId(company.id)}
                  className={clsx('flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left', selected ? 'border-clay-lavender bg-clay-lavender/20' : 'border-clay-hairline')}
                >
                  {selected ? <CircleDot className="h-4 w-4 shrink-0 text-clay-lavender" aria-hidden="true" /> : <Circle className="h-4 w-4 shrink-0 text-clay-muted-soft" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-clay-ink">{company.name}</span>
                    <span className="block truncate text-[11px] text-clay-muted">{metaLine(company, historyOf(history, company.id))}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-clay-muted">{mergeSummary(keep, other, historyOf(history, other.id))}</p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => void merge()} disabled={busy} className={primary}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} Merge
            </button>
            <button type="button" onClick={cancel} disabled={busy} className={ghost}>Cancel</button>
          </div>
        </>
      ) : step === 'branch' ? (
        <>
          <p className="text-sm leading-relaxed text-clay-body">
            <span className="font-medium text-clay-ink">{branch.name}</span> is a branch of <span className="font-medium text-clay-ink">{parent.name}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void saveBranch()} disabled={busy} className={primary}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} Save
            </button>
            <button type="button" onClick={() => setParentId(branch.id)} disabled={busy} className={button}>
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" /> Swap
            </button>
            <button type="button" onClick={cancel} disabled={busy} className={ghost}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {[a, b].map((company) => (
            <button
              key={company.id}
              type="button"
              onClick={() => onOpenCompany(company.id)}
              aria-label={`Open ${company.name}`}
              className="flex w-full items-center gap-2.5 rounded-lg py-1 text-left"
            >
              <CompanyLogo src={company.logo_url} name={company.name} id={company.id} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-clay-ink">{company.name}</span>
                <span className="block truncate text-[11px] text-clay-muted">{metaLine(company, historyOf(history, company.id))}</span>
              </span>
            </button>
          ))}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pair.reasons.map((reason) => (
              <span key={reasonLabel(reason)} className="rounded bg-clay-lavender/20 px-1.5 py-0.5 text-[11px] text-clay-ink">{reasonLabel(reason)}</span>
            ))}
            {pair.likelyParentId && <span className="rounded bg-clay-card px-1.5 py-0.5 text-[11px] text-clay-muted">Looks like a branch</span>}
            <span className="flex-1" />
            <span className="flex items-center gap-1.5">
              <button type="button" onClick={() => setStep('merge')} disabled={busy} className={button}>Merge</button>
              <button type="button" onClick={() => setStep('branch')} disabled={busy} className={pair.likelyParentId ? primary : button}>Branch of</button>
              <button type="button" onClick={() => void notDuplicate()} disabled={busy} className={ghost}>Not a duplicate</button>
            </span>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-xs text-clay-error">{error}</p>}
    </div>
  );
}
