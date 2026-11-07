'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import { GrowthChip, focusRing } from '@/components/GrowthRow';
import * as social from '@/lib/social';
import {
  METRICOOL_CONNECTIONS_URL,
  SERIES_WEEKS,
  buildChannelGrowth,
  compactNumber,
  signed,
  weekLine,
  weekRange,
  type ChannelGrowth as Channel,
  type SocialSnapshot,
} from '@/utils/social';

/** First day loaded: enough weeks for the line, plus one. */
function since(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - (SERIES_WEEKS + 1) * 7)).toISOString().slice(0, 10);
}

/** The channel's last weeks as a line that draws in left to right (lp-reveal; still under reduced motion). */
function Sparkline({ series, label }: { series: (number | null)[]; label: string }) {
  const known = series.filter((v): v is number => v != null);
  if (known.length < 2) return <span className="block h-8 w-24" aria-hidden="true" />;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const points = series
    .map((v, i) => (v == null ? null : [(i / Math.max(1, series.length - 1)) * 100, 28 - ((v - min) / span) * 24] as const))
    .filter((p): p is readonly [number, number] => p !== null);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <span role="img" aria-label={label} className="lp-reveal block h-8 w-24 shrink-0">
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden="true">
        <path d={`${line} L100,32 L0,32 Z`} className="fill-clay-lavender/20" />
        <path d={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="stroke-zams-violet dark:stroke-clay-lavender" />
      </svg>
    </span>
  );
}

function ChannelRow({ channel, index }: { channel: Channel; index: number }) {
  const { latest } = channel;
  const change = signed(latest.followers_change);
  const line = weekLine(latest);
  const headline = latest.followers != null
    ? { value: compactNumber(latest.followers), unit: channel.network === 'youtube' ? 'subscribers' : 'followers' }
    : latest.views != null ? { value: compactNumber(latest.views), unit: 'views this week' } : null;
  return (
    <li
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
      data-testid="channel-row"
      className="lp-rise flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-clay-hairline px-1 py-2.5 first:border-t-0"
    >
      <div className="min-w-0 flex-[1_1_220px]">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-sm font-semibold text-clay-ink">{channel.label}</span>
          {headline && (
            <span className="text-sm tabular-nums text-clay-ink">
              {headline.value} <span className="text-xs text-clay-muted">{headline.unit}</span>
            </span>
          )}
          {change && (
            <GrowthChip tone={latest.followers_change! > 0 ? 'mint' : latest.followers_change! < 0 ? 'late' : 'plain'}>
              {change} this week
            </GrowthChip>
          )}
        </div>
        {line && <p className="mt-0.5 truncate text-xs text-clay-muted" title={line}>{line}</p>}
      </div>
      <Sparkline
        series={channel.series}
        label={`${channel.label} ${channel.seriesOf} over the last ${channel.series.length} weeks`}
      />
    </li>
  );
}

/**
 * Each linked channel's week: followers and how they moved, reach, views, interactions,
 * posts, and a line of the last weeks. Filled every Monday from Metricool (free plan),
 * so it says which week it shows.
 */
export default function ChannelGrowth({ today }: { today: string }) {
  const [rows, setRows] = useState<SocialSnapshot[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    social.getSocialSnapshots(since(today)).then(
      data => { if (!cancelled) { setRows(data); setFailed(false); } },
      () => { if (!cancelled) setFailed(true); },
    );
    return () => { cancelled = true; };
  }, [today]);

  const channels = useMemo(() => buildChannelGrowth(rows ?? []), [rows]);
  const latest = channels.reduce<SocialSnapshot | null>(
    (best, c) => (!best || c.latest.period_start > best.period_start ? c.latest : best),
    null,
  );

  return (
    <section aria-labelledby="growth-channel-growth" className="min-w-0 rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="growth-channel-growth" className="text-sm font-semibold text-clay-ink">Channel growth</h2>
        {latest && <span className="text-xs text-clay-muted">Week of {weekRange(latest.period_start, latest.period_end)} · from Metricool</span>}
      </div>
      {failed ? (
        <p role="status" className="py-2 text-xs text-clay-muted">Channel numbers didn’t load.</p>
      ) : rows === null ? (
        <p role="status" className="py-2 text-xs text-clay-muted">Loading…</p>
      ) : channels.length === 0 ? (
        <div className="py-2 text-sm text-clay-muted">
          <p>No channels yet. Link Instagram, Facebook, TikTok and the rest in Metricool; their numbers arrive here every Monday.</p>
          <a
            href={METRICOOL_CONNECTIONS_URL}
            target="_blank"
            rel="noreferrer"
            className={clsx('mt-1 inline-flex min-h-11 items-center gap-1.5 font-medium text-clay-lavender underline underline-offset-2', focusRing)}
          >
            Open Metricool connections <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      ) : (
        <ul>
          {channels.map((channel, i) => <ChannelRow key={channel.network} channel={channel} index={i} />)}
        </ul>
      )}
    </section>
  );
}
