'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Crown, FileUp, Loader2, Trophy } from 'lucide-react';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import { CelebrateProvider, useCelebrate } from '@/components/game/Celebrate';
import CompanyLogo from '@/components/CompanyLogo';
import SalesImport from '@/components/SalesImport';
import { PageTransition } from '@/components/motion';
import * as sales from '@/lib/sales';
import { formatBaht } from '@/utils/format';
import { businessDaysBetween } from '@/utils/business-time';
import { useBusinessDateKey } from '@/utils/useBusinessDateKey';
import { monthLabel, shortCustomerName, shortDate, splitRegulars, usualMonth, type CustomerRhythm, type RhythmView } from '@/utils/sales-rhythm';
import { bestMonth, importGain, monthPace, regularsLine } from '@/utils/sales-game';

const MONTHS_SHOWN = 13;
const QUIET_SHOWN = 5;
/** Older than this, the page asks for a FlowAccount import. */
const STALE_AFTER_DAYS = 14;

function monthKeys(today: string): string[] {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: MONTHS_SHOWN }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (MONTHS_SHOWN - 1 - i), 1));
    return d.toISOString().slice(0, 10);
  });
}

const STATUS_CHIP: Record<RhythmView['status'], string> = {
  on_track: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  due: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  late: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  quiet: 'bg-clay-surface text-clay-muted',
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const STATUS_WORD: Record<RhythmView['status'], string> = { on_track: 'next', due: 'due', late: 'late', quiet: 'quiet' };

interface SalesData {
  months: sales.MonthTotal[];
  rhythms: CustomerRhythm[];
  latestInvoice: string | null;
}

export default function SalesPage() {
  return (
    <CelebrateProvider>
      <Sales />
    </CelebrateProvider>
  );
}

function Sales() {
  const today = useBusinessDateKey();
  const { companies } = useCrm();
  const { addToast } = useToast();
  const { fire } = useCelebrate();
  const board = useRef<HTMLDivElement | null>(null);
  // The month totals just before an import, so the page can say what it added.
  const beforeImport = useRef<{ months: sales.MonthTotal[]; above: boolean } | null>(null);
  const [data, setData] = useState<SalesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showAllQuiet, setShowAllQuiet] = useState(false);

  const keys = useMemo(() => monthKeys(today), [today]);
  // Bumped after an import to load the page again.
  const [loadCount, setLoadCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([sales.getSalesByMonth(keys[0]), sales.getCustomerRhythms(), sales.getLatestInvoiceDate()]).then(
      ([months, rhythms, latestInvoice]) => {
        if (cancelled) return;
        setData({ months, rhythms, latestInvoice });
        setError(null);
      },
      (err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'unknown error'); },
    );
    return () => { cancelled = true; };
  }, [keys, loadCount]);

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const { regulars, quiet } = useMemo(() => splitRegulars(data?.rhythms ?? [], today), [data, today]);
  const byMonth = useMemo(() => new Map((data?.months ?? []).map((m) => [m.month, m])), [data]);
  const thisMonth = byMonth.get(keys[keys.length - 1]);
  const usual = usualMonth(data?.months ?? [], keys[keys.length - 1]);
  const peak = Math.max(1, ...(data?.months ?? []).map((m) => m.amount));
  const stale = data?.latestInvoice ? businessDaysBetween(data.latestInvoice, today) > STALE_AFTER_DAYS : Boolean(data);
  const pace = useMemo(() => monthPace(data?.months ?? [], keys[keys.length - 1], usual), [data, keys, usual]);
  const best = useMemo(() => bestMonth((data?.months ?? []).filter(m => keys.includes(m.month))), [data, keys]);
  const standing = useMemo(() => regularsLine(regulars), [regulars]);

  // After an import: say what it added, drop coins on the scoreboard, gold if it passed a usual month.
  useEffect(() => {
    const before = beforeImport.current;
    if (!before || !data) return;
    beforeImport.current = null;
    const gain = importGain(before.months, data.months);
    if (gain.amount > 0) {
      fire('coins', board.current);
      addToast(`+${formatBaht(gain.amount)} invoiced${gain.orders ? ` · ${plural(gain.orders, 'order')}` : ''}`);
    }
    if (!before.above && pace.above) {
      setTimeout(() => fire('gold', board.current), 700);
      addToast(`${new Date(`${keys[keys.length - 1]}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })} passed a usual month`);
    }
  }, [data, pace.above, fire, addToast, keys]);

  const row = (r: RhythmView) => {
    const company = r.crm_company_id ? companyById.get(r.crm_company_id) : undefined;
    const name = company?.name ?? shortCustomerName(r.name_en);
    const body = (
      <>
        <span className="flex min-w-0 items-center gap-2.5">
          <CompanyLogo src={company?.logo_url} name={name} id={company?.id ?? r.customer_id} size={28} />
          <span className="truncate font-medium text-clay-ink">{name}</span>
        </span>
        <span className="hidden text-clay-muted sm:block">{r.median_gap_days ? `~${plural(r.median_gap_days, 'day')}` : '—'}</span>
        <span className="text-clay-muted">{shortDate(r.last_order, r.status === 'quiet')}</span>
        <span className="hidden text-clay-ink sm:block">{formatBaht(r.median_value)}</span>
        <span className="text-right">
          {r.status === 'quiet' ? (
            <span className="text-xs text-clay-muted">{Math.round(r.daysSinceLast / 30)} mo ago</span>
          ) : (
            <span className={clsx('inline-block rounded-md px-2 py-0.5 text-xs font-medium', STATUS_CHIP[r.status])}>
              {STATUS_WORD[r.status]}{r.expected ? ` · ${shortDate(r.expected)}` : ''}
            </span>
          )}
        </span>
      </>
    );
    const cls = 'grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.6fr)_0.8fr_0.8fr_0.7fr_1fr] items-center gap-3 border-t border-clay-hairline px-1 py-2.5 text-sm';
    return company ? (
      <Link key={r.customer_id} href={`/companies?company=${company.id}`} className={clsx(cls, 'active:bg-clay-surface')}>{body}</Link>
    ) : (
      <div key={r.customer_id} className={cls} title="Not linked to a LeadPulse account">{body}</div>
    );
  };

  return (
    <PageTransition className="p-4 md:p-6 max-w-4xl pb-20 lg:pb-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-semibold text-clay-ink">Sales</h1>
        {!importing && (
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="flex items-center gap-2 rounded-lg bg-clay-ink px-3 py-2 text-sm font-medium text-clay-canvas motion-press"
          >
            <FileUp className="h-4 w-4" /> <span>Import from FlowAccount</span>
          </button>
        )}
      </div>

      {importing && (
        <SalesImport
          onClose={() => setImporting(false)}
          onSaved={() => {
            beforeImport.current = { months: data?.months ?? [], above: pace.above };
            setImporting(false);
            setLoadCount((n) => n + 1);
          }}
        />
      )}

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">Sales didn’t load: {error}</p>}
      {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-clay-muted" />}

      {data && (
        <>
          {stale && !importing && (
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="mb-4 block w-full rounded-lg bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              {data.latestInvoice ? `Invoices are in up to ${shortDate(data.latestInvoice)}.` : 'No invoices yet.'} Import the latest FlowAccount export to bring every rhythm up to date.
            </button>
          )}

          {/* Summary first: this month against a usual one, then how the regulars stand. */}
          <div ref={board} className="mb-5 grid gap-4 rounded-2xl border border-clay-hairline bg-white p-4 dark:bg-clay-card md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" data-testid="sales-board">
            <div>
              <p className="text-xs font-medium text-clay-muted">{new Date(`${keys[keys.length - 1]}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })} so far</p>
              <p className="mt-0.5 flex items-baseline gap-2">
                <span key={pace.amount} className="lp-pop text-[28px] font-semibold leading-none text-clay-ink">{formatBaht(pace.amount)}</span>
                <span className="text-xs text-clay-muted">{pace.orders ? `${plural(pace.orders, 'order')} · ${plural(thisMonth?.buyers ?? 0, 'buyer')}` : 'no orders yet'}</span>
              </p>
              {pace.usual !== null && (
                <>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-clay-hairline" role="progressbar" aria-label="This month against a usual month" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, pace.share ?? 0) * 100)}>
                    <div className={clsx('lp-grow-x h-full rounded-full', pace.above ? 'bg-clay-ochre' : 'bg-clay-lavender')} style={{ width: `${Math.min(100, Math.round((pace.share ?? 0) * 100))}%` }} />
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-clay-muted">
                    {pace.above ? (
                      <><Trophy className="h-3.5 w-3.5 text-clay-ochre" aria-hidden="true" /><span className="font-semibold text-clay-ink">Above a usual month</span> ({formatBaht(pace.usual)})</>
                    ) : (
                      <>{Math.round((pace.share ?? 0) * 100)}% of a usual month · {formatBaht(Math.max(0, pace.usual - pace.amount))} to go</>
                    )}
                  </p>
                </>
              )}
            </div>
            <div className="md:border-l md:border-clay-hairline md:pl-4">
              <p className="text-xs font-medium text-clay-muted">Regulars</p>
              <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {standing.late > 0 && <a href="#regulars" className="rounded-md bg-red-50 px-2 py-1 font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{standing.late} late</a>}
                {standing.due > 0 && <a href="#regulars" className="rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{standing.due} due</a>}
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{standing.onTrack} on track</span>
                {quiet.length > 0 && <a href="#gone-quiet" className="rounded-md bg-clay-surface px-2 py-1 text-clay-muted dark:bg-clay-hairline/40">{quiet.length} gone quiet</a>}
              </p>
              <p className="mt-2 text-xs text-clay-muted">
                {standing.late + standing.due > 0
                  ? stale && data.latestInvoice
                    ? `${plural(standing.late + standing.due, 'regular')} past their usual reorder, as far as invoices to ${shortDate(data.latestInvoice)} show.`
                    : `${plural(standing.late + standing.due, 'regular')} past their usual reorder. A check-in now keeps the rhythm.`
                  : regulars.length ? 'Every regular is ordering on rhythm.' : 'No regulars yet.'}
              </p>
            </div>
          </div>

          <div className="mb-6" aria-label="Sales by month">
            <div className="flex h-24 items-end gap-1.5">
              {keys.map((k, i) => {
                const m = byMonth.get(k);
                const current = i === keys.length - 1;
                const isBest = best?.month === k;
                return (
                  <div key={k} className="relative flex h-full flex-1 items-end" title={`${monthLabel(k)}: ${formatBaht(m?.amount ?? 0)}${isBest ? ' · best month' : ''}`}>
                    {isBest && <Crown className="absolute -top-1 left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-full text-clay-ochre" aria-hidden="true" />}
                    <div
                      className={clsx('lp-grow-y w-full rounded-t', m ? (isBest ? 'bg-clay-ochre' : current ? 'bg-clay-lavender' : 'bg-clay-lavender/35') : 'bg-clay-hairline')}
                      style={{ height: m ? `${Math.max(4, (m.amount / peak) * 100)}%` : '3px', animationDelay: `${i * 35}ms` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1.5 text-[11px] text-clay-muted">
              {keys.map((k) => (
                <span key={k} className="flex-1 text-center">{monthLabel(k).charAt(0)}</span>
              ))}
            </div>
            {best && <p className="mt-2 text-xs text-clay-muted"><span className="font-medium text-clay-ink">Best month:</span> {monthLabel(best.month)} {formatBaht(best.amount)}</p>}
          </div>

          <h2 id="regulars" className="mb-1 scroll-mt-4 text-sm font-semibold text-clay-ink">Regulars</h2>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,1.6fr)_0.8fr_0.8fr_0.7fr_1fr] gap-3 px-1 pb-1.5 text-xs text-clay-muted">
            <span>Customer</span><span className="hidden sm:block">Orders every</span><span>Last order</span><span className="hidden sm:block">Usual</span><span className="text-right">Next</span>
          </div>
          {regulars.length ? regulars.map(row) : <p className="border-t border-clay-hairline py-3 text-sm text-clay-muted">No regulars yet.</p>}

          {quiet.length > 0 && (
            <>
              <h2 id="gone-quiet" className="mb-1 mt-7 scroll-mt-4 text-sm font-semibold text-clay-ink">Gone quiet</h2>
              {(showAllQuiet ? quiet : quiet.slice(0, QUIET_SHOWN)).map(row)}
              {quiet.length > QUIET_SHOWN && (
                <button type="button" onClick={() => setShowAllQuiet((v) => !v)} className="w-full border-t border-clay-hairline px-1 py-2.5 text-left text-sm text-clay-muted">
                  {showAllQuiet ? 'Show fewer' : `${quiet.length - QUIET_SHOWN} more`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </PageTransition>
  );
}
