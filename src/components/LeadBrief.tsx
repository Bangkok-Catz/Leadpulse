'use client';

// ─── Lead brief: why them, who decides, how to reach them, what to do next ───
// One card for an open lead, built by utils/lead-brief.ts from what LeadPulse already holds.
// It loads the account's fit, sources and waiting proposals itself, so it can sit on any
// surface that has a deal. Nothing here sends anything; the only thing it can save is Pat's
// own decision on an owner the search proposed.

import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowRight, Check, ExternalLink } from 'lucide-react';
import type { Company, Deal } from '@/types/crm';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import { Dots } from '@/components/LeadActions';
import * as crm from '@/lib/crm';
import { sourceChipLabel, type CompanyFit, type EvidenceRow } from '@/utils/account-profile';
import { LADDER, buildLeadBrief } from '@/utils/lead-brief';
import { displayUrl, type EnrichmentProposal } from '@/utils/proposals';
import { useBusinessDateKey } from '@/utils/useBusinessDateKey';

interface Loaded {
  companyId: string;
  fit: CompanyFit | null;
  evidence: EvidenceRow[];
  proposals: EnrichmentProposal[];
}

const label = 'w-[5.5rem] shrink-0 text-xs text-clay-muted';
const small = 'inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-clay-hairline px-2.5 text-xs font-medium text-clay-ink hover:border-clay-lavender disabled:opacity-50';

export default function LeadBrief({ deal, company, onWrite }: {
  deal: Deal;
  company: Company | undefined;
  /** open the draft for this lead; the button is left out without it */
  onWrite?: () => void;
}) {
  const { contacts, meetings = [], refresh } = useCrm();
  const { addToast } = useToast();
  const today = useBusinessDateKey();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const companyId = company?.id ?? null;

  const load = useCallback(async (id: string) => {
    // Each read stands alone: a failed one leaves its part of the brief empty, never the card.
    const [fit, evidence, proposals] = await Promise.all([
      crm.getCompanyFit(id).catch(() => null),
      crm.getCompanyEvidence(id).catch(() => [] as EvidenceRow[]),
      crm.getPendingProposals(id).catch(() => [] as EnrichmentProposal[]),
    ]);
    return { companyId: id, fit, evidence, proposals };
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let live = true;
    load(companyId).then(next => { if (live) setLoaded(next); });
    return () => { live = false; };
  }, [companyId, load]);

  const mine = loaded && loaded.companyId === companyId ? loaded : null;
  const brief = useMemo(
    () => buildLeadBrief({ deal, company, contacts, meetings, evidence: mine?.evidence, proposals: mine?.proposals, fit: mine?.fit, today }),
    [deal, company, contacts, meetings, mine, today],
  );
  if (!brief || !companyId) return null;

  const decide = async (id: string, action: 'save' | 'reject') => {
    setBusy(true);
    try {
      const result = await crm.decideProposalInApp(id, action);
      if (result.retry) { addToast('Could not save. Try again.', 'error'); return; }
      addToast(action === 'reject' ? 'Not saved' : result.status === 'applied' ? 'Saved as a contact' : (result.note || 'Not saved'));
      await refresh();
      setLoaded(await load(companyId));
    } catch {
      addToast('Could not save. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const { advice, decider, proposed, fit, route } = brief;
  return (
    <section aria-label="Lead brief" data-testid="lead-brief" className="rounded-xl border border-clay-hairline bg-white dark:bg-clay-card">
      <div className="border-l-[3px] border-clay-lavender px-3.5 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-clay-muted">Next step</p>
        <p className="mt-0.5 text-sm font-semibold leading-snug text-clay-ink" data-testid="lead-brief-action">{advice.action}</p>
        <p className="mt-1 text-xs leading-relaxed text-clay-body">{advice.reason}</p>
        {advice.also && <p className="mt-1 text-xs leading-relaxed text-clay-muted">Also: {advice.also}</p>}
        {proposed && !decider && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" disabled={busy} onClick={() => decide(proposed.id, 'save')} className={clsx(small, 'border-clay-lavender/60 bg-clay-lavender/20')}>
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> Save as contact
            </button>
            <button type="button" disabled={busy} onClick={() => decide(proposed.id, 'reject')} className={small}>Not right</button>
            <a href={proposed.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-clay-lavender hover:underline">
              {displayUrl(proposed.sourceUrl)} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        )}
        {onWrite && (advice.kind === 'first_touch' || advice.kind === 'follow_up') && (
          <button type="button" onClick={onWrite} className={clsx(small, 'mt-2')}>
            Write it <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <dl className="divide-y divide-clay-hairline border-t border-clay-hairline text-[13px]">
        <div className="flex gap-2 px-3.5 py-2.5">
          <dt className={label}>Who decides</dt>
          <dd className="min-w-0 flex-1">
            {decider ? (
              <>
                <p className="text-clay-ink"><span className="font-medium">{decider.contact.name}</span>{decider.role ? ` · ${decider.role}` : ''}</p>
                <ol className="mt-1.5 flex flex-wrap gap-1" aria-label="How well this person is verified">
                  {LADDER.map(step => (
                    <li
                      key={step.key}
                      className={clsx(
                        'inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px]',
                        decider.steps[step.key] ? 'bg-clay-lavender/20 text-clay-ink' : 'bg-clay-surface text-clay-muted-soft dark:bg-clay-hairline/40',
                      )}
                    >
                      {decider.steps[step.key] && <Check className="h-3 w-3" aria-hidden="true" />}
                      <span className="sr-only">{decider.steps[step.key] ? 'Yes: ' : 'Not yet: '}</span>{step.label}
                    </li>
                  ))}
                </ol>
                {decider.source && (
                  <a href={decider.source.source_url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-clay-lavender hover:underline">
                    Source: {sourceChipLabel(decider.source)} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </>
            ) : proposed ? (
              <p className="text-clay-ink"><span className="font-medium">{proposed.name}</span>{proposed.role ? ` · ${proposed.role}` : ''} <span className="text-clay-muted">· found, waiting for you</span></p>
            ) : (
              <p className="text-clay-muted">No owner on file</p>
            )}
          </dd>
        </div>
        <div className="flex gap-2 px-3.5 py-2.5">
          <dt className={label}>Way in</dt>
          <dd className="min-w-0 flex-1 text-clay-ink">
            {route ? route.label : <span className="text-clay-muted">None yet</span>}
            {brief.touches > 0 && <span className="ml-2 whitespace-nowrap text-xs text-clay-muted"><Dots done={brief.touches} />{brief.touches} sent</span>}
          </dd>
        </div>
        <div className="flex gap-2 px-3.5 py-2.5">
          <dt className={label}>Why them</dt>
          <dd className="min-w-0 flex-1">
            <span className={clsx('inline-flex h-6 items-center rounded-md px-2 text-[11px]', fit.fits ? 'bg-clay-lavender/20 text-clay-ink' : 'bg-clay-surface text-clay-muted dark:bg-clay-hairline/40')}>
              {fit.fits === null ? fit.label : `Laya: ${fit.label.toLowerCase()}`}
            </span>
            {fit.why && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-clay-body">{fit.why}</p>}
          </dd>
        </div>
      </dl>
    </section>
  );
}
