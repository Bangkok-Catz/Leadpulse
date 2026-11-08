'use client';

// Pipeline → Prospects: accounts that pass the deterministic prospect pre-gates,
// reviewed one at a time and promoted into the pipeline with "Start a deal".
// The Laya fit judgments, terminal and evaluator diagnostics live on /lab.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ChevronDown, Plus, Search } from 'lucide-react';
import { useCrm } from '@/components/CrmProvider';
import ProspectReviewPanel from '@/components/ProspectReviewPanel';
import { loadProspectReviews, type ProspectReviewRow, type ReviewsLoad } from '@/lib/prospectReviews';
import { isOnJourneyBoard } from '@/utils/deal-workflow';
import { buildProspectFitReport, orderCandidates, type ProspectCandidate } from '@/utils/prospectFit';
import { buildProspectSourceRows, filterProspects } from '@/utils/prospectReview';
import {
  decisionSpec,
  isOverdue,
  summariseReviews,
  type FollowupDeal,
  type ReviewDecision,
} from '@/utils/prospectReviewDecision';

type ReviewTab = 'unreviewed' | ReviewDecision | 'all';

const TABS: { id: ReviewTab; label: string }[] = [
  { id: 'unreviewed', label: 'Unreviewed' },
  { id: 'shortlist', label: 'Shortlisted' },
  { id: 'needs_research', label: 'Needs research' },
  { id: 'not_a_fit', label: 'Not a fit' },
  { id: 'all', label: 'All' },
];

const REACH_LABEL: Record<ProspectCandidate['reachability'], string> = {
  named_contact: 'Named contact',
  route_only: 'Shop contact only, no owner yet',
  none: 'No way to reach them yet',
};

export default function ProspectsTab({ onStartDeal }: { onStartDeal: (companyId: string) => void }) {
  const { companies, deals, meetings, accountEvents, contacts, refresh } = useCrm();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ReviewTab>('unreviewed');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, ProspectReviewRow>>({});
  const [reviewsUnavailable, setReviewsUnavailable] = useState(false);
  const [includeInPipeline, setIncludeInPipeline] = useState(false);

  const { candidates: allCandidates, error } = useMemo(() => {
    try {
      const rows = buildProspectSourceRows({ companies, deals, meetings, events: accountEvents, contacts });
      const report = buildProspectFitReport(rows, { source: 'live CRM', now: new Date() });
      return { candidates: orderCandidates(report.candidates, {}).queue, error: null };
    } catch (e) {
      return { candidates: [] as ProspectCandidate[], error: (e as Error).message };
    }
  }, [companies, deals, meetings, accountEvents, contacts]);

  const companiesInPipeline = useMemo(
    () => new Set(deals.filter(isOnJourneyBoard).map((d) => d.company_id).filter(Boolean)),
    [deals],
  );
  // Most pre-gate candidates already have an open deal; those live on the board, so they
  // are hidden unless asked for.
  const inPipelineCount = allCandidates.filter((c) => companiesInPipeline.has(c.company_id)).length;
  const candidates = useMemo(
    () => (includeInPipeline ? allCandidates : allCandidates.filter((c) => !companiesInPipeline.has(c.company_id))),
    [allCandidates, companiesInPipeline, includeInPipeline],
  );

  const applyReviews = useCallback((res: ReviewsLoad) => {
    if (res.ok) setReviews(Object.fromEntries(res.rows.map((r) => [r.company_id, r])));
    setReviewsUnavailable(!res.ok);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadProspectReviews().then((res) => { if (!cancelled) applyReviews(res); });
    return () => { cancelled = true; };
  }, [applyReviews]);

  // A saved review may move a deal's follow-up date, so the CRM is refreshed too.
  const handleReviewChanged = useCallback(async () => {
    applyReviews(await loadProspectReviews());
    await refresh();
  }, [applyReviews, refresh]);

  const summary = useMemo(
    () => summariseReviews(Object.values(reviews), candidates.map((c) => c.company_id)),
    [reviews, candidates],
  );
  const counts: Record<ReviewTab, number> = {
    unreviewed: summary.unreviewed,
    shortlist: summary.shortlist,
    needs_research: summary.needs_research,
    not_a_fit: summary.not_a_fit,
    all: summary.total,
  };

  const visible = useMemo(() => {
    const base = filterProspects(candidates, { query, judgment: null, reachability: null });
    if (tab === 'all') return base;
    if (tab === 'unreviewed') return base.filter((c) => !reviews[c.company_id]);
    return base.filter((c) => reviews[c.company_id]?.decision === tab);
  }, [candidates, query, tab, reviews]);

  if (error) {
    return <p role="alert" className="rounded-xl border border-clay-error/40 bg-clay-error/5 p-4 text-sm text-clay-ink">Prospects could not be built: {error}</p>;
  }

  return (
    <section aria-label="Prospects">
      <p className="mb-3 text-sm text-clay-muted">
        Accounts worth a first approach. Review them here, then start a deal to put one on the board.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-clay-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prospects…"
            className="w-full rounded-lg border border-clay-hairline bg-white py-2.5 pl-9 pr-3 text-sm dark:bg-clay-card focus:outline-none focus:ring-2 focus:ring-clay-ink"
          />
        </div>
        {inPipelineCount > 0 && (
          <label className="flex min-h-11 items-center gap-2 text-xs text-clay-muted">
            <input
              type="checkbox"
              checked={includeInPipeline}
              onChange={(e) => setIncludeInPipeline(e.target.checked)}
              className="h-4 w-4 accent-clay-ink"
            />
            Include {inPipelineCount} already in the pipeline
          </label>
        )}
      </div>

      <div role="tablist" aria-label="Review status" className="mb-3 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium',
              tab === t.id ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
            )}
          >
            {t.label} <span className="font-normal opacity-75">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {reviewsUnavailable && (
        <p className="mb-3 text-xs text-clay-muted">Saved reviews didn’t load, so every prospect shows as unreviewed.</p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-clay-hairline bg-white p-6 text-sm text-clay-muted dark:bg-clay-card">
          {candidates.length === 0 ? 'Every prospect already has a deal on the board.' : 'No prospects match.'}
        </p>
      ) : (
        <ul className="divide-y divide-clay-hairline rounded-xl border border-clay-hairline bg-white dark:bg-clay-card">
          {visible.map((c) => {
            const isOpen = expanded === c.company_id;
            const review = reviews[c.company_id] ?? null;
            const inPipeline = companiesInPipeline.has(c.company_id);
            return (
              <li key={c.company_id}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : c.company_id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-clay-ink">{c.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-clay-muted">
                      <span>{REACH_LABEL[c.reachability]}</span>
                      {review && (
                        <span className="rounded bg-clay-lavender/10 px-1.5 py-0.5 font-medium text-clay-lavender">
                          {decisionSpec(review.decision).short}
                        </span>
                      )}
                      {inPipeline && (
                        <span className="rounded bg-clay-mint/20 px-1.5 py-0.5 font-medium text-clay-teal">In pipeline</span>
                      )}
                      {review && isOverdue(review.next_action_due, new Date()) && (
                        <span className="text-clay-error">follow-up overdue</span>
                      )}
                    </span>
                  </span>
                  <ChevronDown className={clsx('h-4 w-4 shrink-0 text-clay-muted transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-clay-hairline px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {!inPipeline && (
                        <button
                          type="button"
                          onClick={() => onStartDeal(c.company_id)}
                          className="clay-btn-primary motion-press min-h-11"
                        >
                          <Plus className="h-4 w-4" /> Start a deal
                        </button>
                      )}
                      <Link
                        href={`/companies?company=${encodeURIComponent(c.company_id)}`}
                        className="inline-flex min-h-11 items-center rounded-lg border border-clay-hairline px-3 text-sm font-medium text-clay-ink hover:border-clay-lavender"
                      >
                        Open account
                      </Link>
                    </div>
                    <ProspectReviewPanel
                      key={c.company_id}
                      companyId={c.company_id}
                      companyName={c.name}
                      archetypeId=""
                      deals={(deals as unknown as FollowupDeal[]).filter((d) => d.company_id === c.company_id)}
                      review={review}
                      onChanged={handleReviewChanged}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
