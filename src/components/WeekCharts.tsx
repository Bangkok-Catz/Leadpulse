// ─── This week: the small 2D charts on the four stat cards ───
// Flat shapes that animate in once (bars grow, the ring turns into place, the line draws
// itself), then hold still apart from one soft pulse on what needs you. Reduced motion
// gets the finished chart with no movement (globals.css). Decorative: the card's number
// and written line carry the meaning.

import type { CSSProperties } from 'react';
import clsx from 'clsx';

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/** Overdue by age: one bar per group (over 2 weeks, last week, this week). */
export function OverdueBars({ groups }: { groups: [number, number, number] }) {
  const max = Math.max(1, ...groups);
  const labels = ['2 wk+', 'Last wk', 'This wk'];
  const tones = ['bg-clay-error', 'bg-clay-error/60', 'bg-clay-error/30'];
  return (
    <span className="flex h-full flex-col justify-center gap-1.5">
      {groups.map((count, i) => (
        <span key={labels[i]} className="grid grid-cols-[44px_minmax(0,1fr)_16px] items-center gap-1.5 text-[10px] text-clay-muted">
          <span className="truncate">{labels[i]}</span>
          <span className="relative h-2 rounded-full bg-clay-surface dark:bg-clay-hairline/50">
            {count > 0 && (
              <span
                className={clsx('lp-grow-x absolute inset-y-0 left-0 rounded-full', tones[i])}
                style={{ ...delay(120 + i * 90), width: `${Math.max(8, (count / max) * 100)}%` }}
              />
            )}
            {i === 0 && count > 0 && (
              <span className="lp-ping absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-clay-error text-clay-error" style={{ left: `calc(${Math.max(8, (count / max) * 100)}% - 4px)` }} />
            )}
          </span>
          <span className="text-right tabular-nums">{count}</span>
        </span>
      ))}
    </span>
  );
}

/** Due in the next seven days: one column per day, today first. */
export function WeekColumns({ counts, letters }: { counts: number[]; letters: string[] }) {
  const max = Math.max(1, ...counts);
  return (
    <span className="flex h-full items-end gap-1">
      {counts.map((count, i) => (
        <span key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span className="relative flex w-full flex-1 items-end justify-center">
            <span
              className={clsx(
                'lp-grow-y w-full max-w-[18px] rounded-[4px]',
                count === 0 ? 'bg-clay-hairline/70' : i === 0 ? 'bg-clay-coral' : 'bg-clay-lavender',
                count > 0 && i === 0 && 'lp-bob',
              )}
              style={{ ...delay(80 + i * 55), height: count === 0 ? '3px' : `${Math.max(18, (count / max) * 100)}%` }}
            />
          </span>
          <span className={clsx('text-[10px] leading-none', i === 0 ? 'font-semibold text-clay-ink' : 'text-clay-muted')}>{letters[i]}</span>
        </span>
      ))}
    </span>
  );
}

const RING_TONE = {
  at_risk: 'stroke-clay-coral',
  dormant: 'stroke-clay-muted-soft',
  watch: 'stroke-clay-ochre',
  reorder_only: 'stroke-clay-lavender',
  healthy: 'stroke-clay-mint',
} as const;
type RingKey = keyof typeof RING_TONE;
const RING_LABEL: Record<RingKey, string> = { at_risk: 'at risk', dormant: 'dormant', watch: 'watch', reorder_only: 'reorder', healthy: 'healthy' };

/** Check-ins by health: a ring split by tier, with the two biggest tiers named beside it. */
export function CheckInRing({ split }: { split: Record<RingKey, number> }) {
  const order: RingKey[] = ['at_risk', 'dormant', 'watch', 'reorder_only', 'healthy'];
  const total = order.reduce((sum, k) => sum + split[k], 0);
  const gap = total > 1 ? 1.5 : 0;
  let start = 0;
  const arcs = order.filter(k => split[k] > 0).map(k => {
    const len = (split[k] / Math.max(1, total)) * 100;
    const arc = { k, len: Math.max(0.5, len - gap), start };
    start += len;
    return arc;
  });
  const top = [...arcs].sort((a, b) => b.len - a.len).slice(0, 2);
  return (
    <span className="flex h-full items-center gap-3">
      <svg viewBox="0 0 64 64" className="lp-turn-in h-full max-h-[64px] w-auto shrink-0 -rotate-90" style={delay(100)}>
        <circle cx="32" cy="32" r="24" fill="none" strokeWidth="9" className="stroke-clay-surface dark:stroke-clay-hairline/50" />
        {arcs.map((a, i) => (
          <circle
            key={a.k}
            cx="32" cy="32" r="24" fill="none" strokeWidth="9" pathLength={100}
            strokeDasharray={`${a.len} ${100 - a.len}`}
            strokeDashoffset={-a.start}
            className={clsx('lp-fade', RING_TONE[a.k])}
            style={delay(180 + i * 80)}
          />
        ))}
      </svg>
      <span className="min-w-0 space-y-1 text-[10px] text-clay-muted">
        {top.map(a => (
          <span key={a.k} className="flex items-center gap-1.5">
            <svg viewBox="0 0 8 8" className="h-2 w-2 shrink-0"><circle cx="4" cy="4" r="4" className={clsx('fill-current', RING_TONE[a.k].replace('stroke-', 'text-'))} /></svg>
            <span className="truncate"><span className="tabular-nums text-clay-ink">{split[a.k]}</span> {RING_LABEL[a.k]}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** Touches over the last seven days: a line and soft area that draw in left to right. */
export function TouchLine({ series }: { series: number[] }) {
  const max = Math.max(1, ...series);
  const pts = series.map((v, i) => [(i / Math.max(1, series.length - 1)) * 100, 36 - (v / max) * 30] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts.at(-1) ?? [100, 36];
  return (
    <span className="relative block h-full">
      <span className="lp-reveal absolute inset-x-0 top-0 bottom-3.5 block" style={delay(120)}>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <path d={`${line} L100,40 L0,40 Z`} className="fill-clay-mint/25 dark:fill-clay-mint/15" />
          <path d={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="stroke-clay-teal dark:stroke-clay-mint" />
        </svg>
        <span
          className="lp-ping absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-clay-teal text-clay-teal dark:bg-clay-mint dark:text-clay-mint"
          style={{ left: `${last[0]}%`, top: `${(last[1] / 40) * 100}%` }}
        />
      </span>
      <span className="absolute inset-x-0 bottom-0 flex justify-between text-[10px] leading-none text-clay-muted">
        <span>7 days ago</span>
        <span>today</span>
      </span>
    </span>
  );
}
