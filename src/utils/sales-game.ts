// ─── Sales, as a scoreboard ───
// Pure. The Sales page leads with this month against a usual month (the median of past
// months, utils/sales-rhythm.ts usualMonth), marks the best month in gold, says how the
// regulars stand in one line, and tells what an import added. Every figure is invoiced
// sales from FlowAccount, so it never claims a sale the books don't show.

import type { RhythmView } from './sales-rhythm';

interface Month { month: string; amount: number; orders: number }

export interface MonthPace {
  amount: number;
  orders: number;
  /** the usual month, or null with no history */
  usual: number | null;
  /** share of a usual month, 0..1+ ; null with no history */
  share: number | null;
  /** passed a usual month */
  above: boolean;
}

export function monthPace(months: Month[], monthKey: string, usual: number | null): MonthPace {
  const now = months.find(m => m.month === monthKey);
  const amount = now?.amount ?? 0;
  const share = usual && usual > 0 ? amount / usual : null;
  return { amount, orders: now?.orders ?? 0, usual, share, above: share !== null && share >= 1 };
}

/** The best month shown, or null when nothing was sold. Ties go to the latest. */
export function bestMonth(months: Month[]): { month: string; amount: number } | null {
  let best: Month | null = null;
  for (const m of months) if (m.amount > 0 && (!best || m.amount >= best.amount)) best = m;
  return best ? { month: best.month, amount: best.amount } : null;
}

export interface RegularsLine {
  late: number;
  due: number;
  onTrack: number;
}

export function regularsLine(regulars: RhythmView[]): RegularsLine {
  const out: RegularsLine = { late: 0, due: 0, onTrack: 0 };
  for (const r of regulars) {
    if (r.status === 'late') out.late++;
    else if (r.status === 'due') out.due++;
    else if (r.status === 'on_track') out.onTrack++;
  }
  return out;
}

/** What an import added, from the month totals before and after it. */
export function importGain(before: Month[], after: Month[]): { amount: number; orders: number } {
  const sum = (list: Month[], key: 'amount' | 'orders') => list.reduce((s, m) => s + (m[key] || 0), 0);
  return {
    amount: Math.max(0, Math.round(sum(after, 'amount') - sum(before, 'amount'))),
    orders: Math.max(0, sum(after, 'orders') - sum(before, 'orders')),
  };
}
