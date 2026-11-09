'use client';

import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { CalendarDays, Eye, Send } from 'lucide-react';
import CompanyLogo from '@/components/CompanyLogo';
import { MilestoneTrack } from '@/components/game/Milestones';
import {
  CLOSED_LABELS,
  GROWTH_KIND_LABELS,
  STAGE_LABELS,
  clampStage,
  dueLabel,
  itemLine,
  type GrowthItem,
} from '@/utils/growth';

export const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender';

export const smallBtn = clsx(
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-clay-hairline px-2.5 text-xs font-medium text-clay-ink transition-transform duration-150 ease-out active:scale-[0.97] hover:border-clay-lavender',
  focusRing,
);

const nameClass = 'max-w-full truncate rounded-sm text-sm font-semibold hover:text-clay-lavender';

/** Staggered rise-in, as on This week; capped so long lists never wait on animation. */
const rise = (index: number): CSSProperties => ({ animationDelay: `${Math.min(index, 10) * 40}ms` });

export function GrowthChip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'lavender' | 'ochre' | 'mint' | 'late' }) {
  const tones = {
    plain: 'bg-clay-surface text-clay-muted',
    lavender: 'bg-clay-lavender/20 text-clay-ink',
    ochre: 'bg-clay-ochre/15 text-clay-ink',
    mint: 'bg-clay-mint/20 text-clay-ink',
    late: 'bg-clay-coral/15 font-semibold text-clay-ink',
  };
  return <span className={clsx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[11px]', tones[tone])}>{children}</span>;
}

/**
 * One funding row, in This week's row style: name and chips on top, the next step
 * underneath, its milestones below that, and the actions on the right. The name opens it.
 */
export default function GrowthRow({
  item,
  today,
  index,
  showStage = true,
  onOpen,
  href,
  actions,
  pulse = 0,
}: {
  item: GrowthItem;
  today: string;
  index: number;
  showStage?: boolean;
  /** opens the row in place */
  onOpen?: (item: GrowthItem) => void;
  /** or a link to where it is opened (This week links to the Growth page) */
  href?: string;
  actions?: ReactNode;
  /** bumped when the row just reached a further milestone */
  pulse?: number;
}) {
  const closed = item.status !== 'open';
  const due = closed ? null : dueLabel(item.next_date, today);
  const line = itemLine(item);
  const Icon = item.waiting_since ? Send : item.next_date ? CalendarDays : clampStage(item.stage) === 1 ? Eye : null;

  return (
    <li
      style={rise(index)}
      data-testid="growth-row"
      data-growth-id={item.id}
      className="lp-rise grid grid-cols-[30px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2 border-t border-clay-hairline px-1 py-2.5 first:border-t-0 sm:grid-cols-[30px_minmax(0,1fr)_auto] sm:items-center"
    >
      <span className="self-start"><CompanyLogo name={item.name} id={item.id} size={30} /></span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {href ? (
            <Link href={href} className={clsx(nameClass, closed ? 'text-clay-muted' : 'text-clay-ink', focusRing)}>{item.name}</Link>
          ) : (
            <button type="button" onClick={() => onOpen?.(item)} className={clsx(nameClass, 'text-left', closed ? 'text-clay-muted' : 'text-clay-ink', focusRing)}>
              {item.name}
            </button>
          )}
          {due && <GrowthChip tone={due.tone === 'late' ? 'late' : due.tone === 'soon' ? 'ochre' : 'plain'}>{due.text}</GrowthChip>}
          <GrowthChip tone={closed ? 'plain' : 'lavender'}>{GROWTH_KIND_LABELS[item.kind] ?? item.kind}</GrowthChip>
          {item.offer && <GrowthChip>{item.offer}</GrowthChip>}
          {closed && <GrowthChip>{CLOSED_LABELS[item.status as keyof typeof CLOSED_LABELS]}</GrowthChip>}
        </div>
        {line && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-clay-muted">
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="truncate" title={line}>{line}</span>
          </p>
        )}
        {showStage && !closed && (
          <p className="mt-1.5">
            <MilestoneTrack labels={STAGE_LABELS[item.track]} reached={clampStage(item.stage)} pulse={pulse} />
          </p>
        )}
      </div>
      {actions && <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">{actions}</div>}
    </li>
  );
}
