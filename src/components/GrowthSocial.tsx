'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import type { Company, Deal } from '@/types/crm';
import CompanyLogo from '@/components/CompanyLogo';
import { GrowthChip, focusRing } from '@/components/GrowthRow';
import * as sales from '@/lib/sales';
import { ACQUISITION_SOURCE_LABELS } from '@/utils/acquisition-source';
import { formatBaht } from '@/utils/format';
import {
  CHANNEL_WINDOW_LABELS,
  channelStats,
  resultLine,
  windowStart,
  type ChannelWindow,
} from '@/utils/growth';

/**
 * Social, judged by what it brings: accounts added in the window, by how they came in,
 * how many were won and what they have bought. Bars grow in once (lp-grow-x); reduced
 * motion shows them finished.
 */
export default function GrowthSocial({ companies, deals, today }: { companies: Company[]; deals: Deal[]; today: string }) {
  const [period, setPeriod] = useState<ChannelWindow>('90d');
  const since = windowStart(period, today);
  const [salesByCompany, setSales] = useState<Map<string, number>>(new Map());
  const [salesError, setSalesError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sales.getSalesByCompany(since).then(
      map => { if (!cancelled) { setSales(map); setSalesError(false); } },
      () => { if (!cancelled) setSalesError(true); },
    );
    return () => { cancelled = true; };
  }, [since]);

  const stats = useMemo(() => channelStats({ companies, deals, salesByCompany, since }), [companies, deals, salesByCompany, since]);
  const max = Math.max(1, ...stats.rows.map(r => r.leads));

  return (
    <div className="space-y-4">
      <section aria-labelledby="growth-channels" className="min-w-0 rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="growth-channels" className="text-sm font-semibold text-clay-ink">Where buyers came from</h2>
          <div className="flex gap-1.5" role="group" aria-label="Period">
            {(Object.keys(CHANNEL_WINDOW_LABELS) as ChannelWindow[]).map(w => (
              <button
                key={w}
                type="button"
                aria-pressed={period === w}
                onClick={() => setPeriod(w)}
                className={clsx(
                  'h-7 rounded-lg border px-2.5 text-xs transition-colors',
                  period === w ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
                  focusRing,
                )}
              >
                {CHANNEL_WINDOW_LABELS[w]}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-2 text-xs text-clay-muted">Accounts added since {new Date(`${since}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}, by how they came in.</p>

        {stats.rows.length === 0 ? (
          <p className="py-3 text-sm text-clay-muted">No accounts with a recorded source in this period.</p>
        ) : (
          <>
            <div className="mb-1 flex gap-3.5 text-xs text-clay-muted" aria-hidden="true">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-clay-lavender/55" />Leads</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-zams-violet dark:bg-clay-lavender" />Won</span>
            </div>
            <ul>
              {stats.rows.map((row, i) => (
                <li key={row.source} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-clay-hairline py-2.5 first:border-t-0">
                  <span className="w-[120px] shrink-0 text-[13px] font-medium text-clay-ink">{row.label}</span>
                  <span
                    role="img"
                    aria-label={`${row.label}: ${row.leads} ${row.leads === 1 ? 'lead' : 'leads'}, ${row.won} won, ${formatBaht(row.sales)}`}
                    className="relative h-2.5 min-w-[120px] flex-[1_1_160px] overflow-hidden rounded-full bg-clay-card dark:bg-clay-surface"
                  >
                    <span className="lp-grow-x absolute inset-y-0 left-0 rounded-full bg-clay-lavender/55" style={{ width: `${(row.leads / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
                    {row.won > 0 && (
                      <span className="lp-grow-x absolute inset-y-0 left-0 rounded-full bg-zams-violet dark:bg-clay-lavender" style={{ width: `${Math.max(2, (row.won / max) * 100)}%`, animationDelay: `${120 + i * 60}ms` }} />
                    )}
                  </span>
                  <span className="w-[64px] shrink-0 text-right text-xs tabular-nums text-clay-body">{row.leads} {row.leads === 1 ? 'lead' : 'leads'}</span>
                  <span className="w-[48px] shrink-0 text-right text-xs tabular-nums text-clay-body">{row.won} won</span>
                  <span className="w-[72px] shrink-0 text-right text-xs font-semibold tabular-nums text-clay-ink">{formatBaht(row.sales)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {stats.notRecorded > 0 && (
          <p className="mt-2 text-xs text-clay-muted">
            {stats.notRecorded} {stats.notRecorded === 1 ? 'account has' : 'accounts have'} no source recorded.{' '}
            <Link href="/companies" className={clsx('font-medium text-clay-lavender underline underline-offset-2', focusRing)}>Set it on Accounts</Link>
          </p>
        )}
        {salesError && <p role="status" className="mt-2 text-xs text-clay-muted">Sales didn’t load, so the ฿ column may read low.</p>}
      </section>

      <section aria-labelledby="growth-campaigns" className="min-w-0 rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
        <h2 id="growth-campaigns" className="text-sm font-semibold text-clay-ink">Campaigns</h2>
        {stats.campaigns.length === 0 ? (
          <p className="py-2 text-xs text-clay-muted">No campaign names in this period. Add one with the source on an account, e.g. Meta ad · Bangkok bakeries.</p>
        ) : (
          <ul className="mt-1">
            {stats.campaigns.map(c => (
              <li key={`${c.source}|${c.name}`} className="grid grid-cols-[30px_minmax(0,1fr)] items-start gap-x-2.5 border-t border-clay-hairline px-1 py-2.5 first:border-t-0">
                <CompanyLogo name={c.name} id={`${c.source}|${c.name}`} size={30} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="truncate text-sm font-semibold text-clay-ink">{c.name}</span>
                    <GrowthChip tone="lavender">{ACQUISITION_SOURCE_LABELS[c.source]}</GrowthChip>
                  </div>
                  <p className="mt-0.5 text-xs text-clay-muted">{resultLine(c)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
