'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { SlidersHorizontal, Search, X } from 'lucide-react';
import type { Deal } from '@/types/crm';
import type { BoardAttentionFilter, BoardSort } from '@/utils/deal-board';
import { SOURCE_FILTER_OPTIONS, type SourceFilter } from '@/utils/acquisition-source';
import { formatBaht } from '@/utils/format';
import AnimatedCount from '@/components/AnimatedCount';
import type { PipelineOutcomes } from '@/utils/lane-time';

interface PipelineToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  attentionFilter: BoardAttentionFilter;
  onAttentionChange: (value: BoardAttentionFilter) => void;
  counts: { all: number; overdue: number; today: number; needsReview: number; layaReview: number; missingData?: number; waitingOnYou?: number; stalled?: number; parkSuggested?: number };
  productFilter: string;
  onProductChange: (value: string) => void;
  productOptions: readonly string[];
  priorityFilter: Deal['priority'] | 'all';
  onPriorityChange: (value: Deal['priority'] | 'all') => void;
  sourceFilter: SourceFilter;
  onSourceChange: (value: SourceFilter) => void;
  sort: BoardSort;
  onSortChange: (value: BoardSort) => void;
  filtersActive: boolean;
  onClear: () => void;
  visibleCount: number;
  totalCount: number;
  openPipelineValue: number;
  weightedForecast: number;
  sourceRows: { source: string; won: number; total: number; rate: number }[];
  /** win rate and time to close (lane-time.ts) */
  outcomes?: PipelineOutcomes;
  compact: boolean;
  onToggleCompact: () => void;
  /** Laya's status, shown in the quiet line */
  status?: ReactNode;
}

const chip = (active: boolean) => clsx(
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender',
  active ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-body hover:border-clay-ink/30 hover:text-clay-ink',
);

const select = 'h-10 w-full rounded-lg border border-clay-hairline bg-white px-2.5 text-base text-clay-body focus:outline-none focus:ring-2 focus:ring-clay-lavender/40 dark:bg-clay-card md:text-sm';

/**
 * One row: search, the filters used every day as chips, everything else behind Filter, then
 * Sort. Below it one quiet line: the count, open pipeline, how the board works, Laya, density.
 */
export default function PipelineToolbar({
  searchQuery,
  onSearchChange,
  attentionFilter,
  onAttentionChange,
  counts,
  productFilter,
  onProductChange,
  productOptions,
  priorityFilter,
  onPriorityChange,
  sourceFilter,
  onSourceChange,
  sort,
  onSortChange,
  filtersActive,
  onClear,
  visibleCount,
  totalCount,
  openPipelineValue,
  weightedForecast,
  sourceRows,
  outcomes,
  compact,
  onToggleCompact,
  status,
}: PipelineToolbarProps) {
  const [open, setOpen] = useState(false);
  // Open the menu towards whichever side has room for it.
  const [alignRight, setAlignRight] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleMenu = () => {
    const rect = menuRef.current?.getBoundingClientRect();
    if (rect && typeof window !== 'undefined') setAlignRight(rect.left + 300 > window.innerWidth);
    setOpen(value => !value);
  };

  // Close the Filter menu on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const quick: Array<[BoardAttentionFilter, string, number]> = [
    ['all', 'All', counts.all],
    ['overdue', 'Late', counts.overdue],
    ['today', 'Today', counts.today],
    ['waiting-on-you', 'Waiting on you', counts.waitingOnYou ?? 0],
    ['stalled', 'Stalled', counts.stalled ?? 0],
  ];
  // The rarer reasons a deal needs a look live in the Filter menu; empty ones are left out.
  const lookOptions = ([
    ['needs-review', 'Needs review', counts.needsReview],
    ['laya-review', 'Laya review', counts.layaReview],
    ['park-suggested', 'Park this deal?', counts.parkSuggested ?? 0],
    ['missing-data', 'Missing data', counts.missingData ?? 0],
  ] as Array<[BoardAttentionFilter, string, number]>).filter(([value, , count]) => count > 0 || attentionFilter === value);
  const lookActive = lookOptions.find(([value]) => value === attentionFilter);
  const menuCount = (productFilter !== 'all' ? 1 : 0) + (priorityFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0) + (lookActive ? 1 : 0);

  return (
    <>
    <section className="mb-2 flex flex-wrap items-center gap-2" aria-label="Board filters">
      <label className="relative w-full sm:w-56">
        <span className="sr-only">Search by client or deal name</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-clay-muted" />
        <input
          type="search"
          value={searchQuery}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Search deals"
          className="h-9 w-full rounded-lg border border-clay-hairline bg-white pl-8 pr-3 text-base text-clay-ink placeholder:text-clay-muted focus:outline-none focus:ring-2 focus:ring-clay-lavender/40 dark:bg-clay-card md:text-sm"
        />
      </label>

      {/* Phone: chips, Filter and Sort share one swipe row. Wider: each wraps on its own. */}
      <div className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto no-scrollbar px-4 sm:contents">
        <div className="flex shrink-0 gap-1.5 sm:contents" role="group" aria-label="Show">
          {quick.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => onAttentionChange(attentionFilter === value && value !== 'all' ? 'all' : value)}
              aria-pressed={attentionFilter === value}
              className={chip(attentionFilter === value)}
            >
              {label}
              <AnimatedCount value={count} className={clsx('text-xs', value === 'overdue' && count > 0 ? 'font-semibold text-clay-error' : 'text-clay-muted')} />
            </button>
          ))}
        </div>

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={toggleMenu}
            aria-expanded={open}
            aria-haspopup="dialog"
            className={chip(menuCount > 0)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            {lookActive ? lookActive[1] : 'Filter'}
            {menuCount > 0 && <span className="text-xs font-semibold">{menuCount}</span>}
          </button>
          {open && (
            <div
              role="dialog"
              aria-label="Filter deals"
              className={clsx(
                'fixed inset-x-4 top-24 z-40 rounded-xl border border-clay-hairline bg-white p-3 shadow-lg dark:bg-clay-card sm:absolute sm:inset-x-auto sm:top-11 sm:w-72',
                alignRight ? 'sm:right-0' : 'sm:left-0',
              )}
            >
              {lookOptions.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-clay-muted">Needs a look</p>
                  <div className="flex flex-wrap gap-1.5">
                    {lookOptions.map(([value, label, count]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={attentionFilter === value}
                        onClick={() => { onAttentionChange(attentionFilter === value ? 'all' : value); setOpen(false); }}
                        className={clsx(chip(attentionFilter === value), 'h-8 text-xs')}
                      >
                        {label} <span className="text-clay-muted">{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <label className="text-[11px] font-medium uppercase tracking-wide text-clay-muted">
                  Product
                  <select value={productFilter} onChange={event => onProductChange(event.target.value)} className={clsx(select, 'mt-1 normal-case tracking-normal')}>
                    <option value="all">All products</option>
                    {productOptions.map(product => <option key={product} value={product}>{product}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-medium uppercase tracking-wide text-clay-muted">
                  Priority
                  <select value={priorityFilter} onChange={event => onPriorityChange(event.target.value as Deal['priority'] | 'all')} className={clsx(select, 'mt-1 normal-case tracking-normal')}>
                    <option value="all">Any priority</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="text-[11px] font-medium uppercase tracking-wide text-clay-muted">
                  Came from
                  <select value={sourceFilter} onChange={event => onSourceChange(event.target.value as SourceFilter)} className={clsx(select, 'mt-1 normal-case tracking-normal')}>
                    {SOURCE_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              {menuCount > 0 && (
                <button
                  type="button"
                  onClick={() => { onClear(); setOpen(false); }}
                  className="mt-3 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-clay-muted hover:bg-clay-surface hover:text-clay-ink"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        <label className="shrink-0">
          <span className="sr-only">Sort cards in each lane</span>
          <select
            value={sort}
            onChange={event => onSortChange(event.target.value as BoardSort)}
            title="Do now: late first, then by date. Hottest: highest tier first (Laya's tier where graded). Quietest: longest since the last contact first."
            className="h-9 rounded-lg border border-clay-hairline bg-white px-2.5 text-base text-clay-body focus:outline-none focus:ring-2 focus:ring-clay-lavender/40 dark:bg-clay-card md:text-sm"
          >
            <option value="do-now">Sort: Do now</option>
            <option value="hottest">Sort: Hottest</option>
            <option value="quietest">Sort: Quietest</option>
          </select>
        </label>

        {filtersActive && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-clay-muted hover:bg-clay-surface hover:text-clay-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
          </button>
        )}
      </div>
    </section>

    {/* One quiet line: what the board holds, how it works, Laya, and card density. */}
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-clay-muted">
      <span>{visibleCount === totalCount ? `${totalCount} deals` : `${visibleCount} of ${totalCount} deals`}</span>
      <details className="open:basis-full" aria-label="Pipeline insights">
        <summary className="cursor-pointer list-none marker:hidden hover:text-clay-ink">
          Open pipeline <span className="font-semibold text-clay-ink">{formatBaht(openPipelineValue)}</span> <span aria-hidden="true">⌄</span>
        </summary>
        <div className="mt-2 space-y-1">
          <p>Weighted forecast · <span className="font-semibold text-clay-ink">{formatBaht(weightedForecast)}</span></p>
          {outcomes && outcomes.winRate !== null && (
            <p data-testid="pipeline-outcomes">
              Win rate · <span className="font-semibold text-clay-ink">{outcomes.winRate}%</span> ({outcomes.won} won, {outcomes.lost} lost)
              {outcomes.daysToWin && <> · Time to win · <span className="font-semibold text-clay-ink">{outcomes.daysToWin.average} days</span> (over {outcomes.daysToWin.deals} deals)</>}
              {outcomes.daysToLose && <> · Time to lose · <span className="font-semibold text-clay-ink">{outcomes.daysToLose.average} days</span> (over {outcomes.daysToLose.deals})</>}
            </p>
          )}
          {sourceRows.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {sourceRows.map(s => (
                <span key={s.source}><span className="font-medium text-clay-body">{s.source}</span> {s.won}/{s.total} won · {s.rate.toFixed(0)}%</span>
              ))}
            </div>
          )}
        </div>
      </details>
      <details className="open:basis-full">
        <summary className="cursor-pointer list-none marker:hidden hover:text-clay-ink">How this board works <span aria-hidden="true">⌄</span></summary>
        <p className="mt-1 max-w-xl leading-relaxed">Drag along the five journey stages. Waiting on reply requires logged outreach; Sample requires an address and send intent; Testing needs delivery and a date; Follow-up needs a date. Won / Lost / Park are exits, never columns. Four outbound nudges maximum, then park.</p>
      </details>
      {status}
      <button type="button" onClick={onToggleCompact} className="ml-auto rounded-md px-2 py-1 hover:bg-clay-surface hover:text-clay-ink">
        {compact ? 'Show more detail' : 'Compact cards'}
      </button>
    </div>
    </>
  );
}
