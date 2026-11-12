'use client';

// ─── This week: the board, badges and how points work ───
// The board is the pipeline as five stops. Faces are the deals in today's run and the ones
// done today; when a logged step moves a deal to its next lane, its face slides along to
// the next stop and that stop bumps. Badges are read from what is logged; one that is
// earned right now spins in with a shine.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { ChevronDown, Crown, Flame, Package, Sparkles, Star, Trophy, type LucideIcon } from 'lucide-react';
import CompanyLogo from '@/components/CompanyLogo';
import { POINTS, RUN_SIZE, STOPS, type Badge, type BadgeId, type StopId } from '@/utils/game';

export interface BoardToken {
  dealId: string;
  stop: StopId;
  name: string;
  companyId: string | null;
  logoUrl?: string | null;
}

const MAX_FACES = 3;

export function GameBoard({ counts, tokens, onStop, title = 'Your board', link = { href: '/deals', label: 'Open Pipeline' } }: {
  counts: Record<StopId, number>;
  tokens: BoardToken[];
  /** makes each stop a button (Pipeline: jump to that lane) */
  onStop?: (stop: StopId) => void;
  title?: string;
  link?: { href: string; label: string } | null;
}) {
  const prev = useRef(counts);
  const [bumps, setBumps] = useState<Record<StopId, number>>({ reach: 0, reply: 0, sample: 0, testing: 0, won: 0 });
  useEffect(() => {
    const before = prev.current;
    prev.current = counts;
    const changed = STOPS.filter(s => before[s.id] !== counts[s.id]).map(s => s.id);
    if (changed.length) setBumps(b => Object.fromEntries(STOPS.map(s => [s.id, b[s.id] + (changed.includes(s.id) ? 1 : 0)])) as Record<StopId, number>);
  }, [counts]);

  return (
    <section aria-labelledby="board-head" className="min-w-0 rounded-2xl border border-clay-hairline bg-white p-4 dark:bg-clay-card" data-testid="game-board">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="board-head" className="text-[15px] font-semibold text-clay-ink">{title}</h2>
        {link && <Link href={link.href} className="text-xs text-clay-muted hover:text-clay-ink">{link.label}</Link>}
      </div>
      <ol className="grid grid-cols-5" aria-label="Deals at each step">
        {STOPS.map((stop, i) => {
          const here = tokens.filter(t => t.stop === stop.id);
          const goal = stop.id === 'won';
          return (
            <li key={stop.id} className={clsx('flex min-w-0 flex-col items-center', onStop && 'relative')} aria-label={`${stop.label}: ${counts[stop.id]} ${stop.sub}`}>
              <span className="flex h-[30px] items-center justify-center">
                {here.slice(0, MAX_FACES).map((t, j) => (
                  <motion.span
                    key={t.dealId}
                    layoutId={`board-${t.dealId}`}
                    transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                    className={clsx('relative rounded-full ring-2 ring-white dark:ring-clay-card', j > 0 && '-ml-2')}
                    title={t.name}
                    data-testid="board-token"
                    data-stop={t.stop}
                  >
                    <CompanyLogo src={t.logoUrl} name={t.name} id={t.companyId ?? undefined} size={24} className="rounded-full" />
                  </motion.span>
                ))}
                {here.length > MAX_FACES && <span className="ml-0.5 text-[10px] text-clay-muted">+{here.length - MAX_FACES}</span>}
              </span>
              <span className="relative mt-2 flex w-full justify-center">
                <span
                  aria-hidden="true"
                  className={clsx('absolute top-1/2 h-0.5 -translate-y-1/2 bg-clay-hairline dark:bg-clay-muted-soft/40', i === 0 ? 'left-1/2 right-0' : i === STOPS.length - 1 ? 'left-0 right-1/2' : 'inset-x-0')}
                />
                <span
                  key={bumps[stop.id]}
                  className={clsx(
                    'zams-mono relative grid h-[42px] w-[42px] place-items-center rounded-full border-2 text-[12.5px] tabular-nums text-clay-ink',
                    goal ? 'border-clay-ochre bg-clay-ochre/15' : 'border-clay-hairline bg-white dark:border-clay-muted-soft/50 dark:bg-clay-card',
                    bumps[stop.id] > 0 && 'lp-bump',
                    goal && bumps[stop.id] > 0 && 'lp-glow',
                  )}
                >
                  {counts[stop.id]}
                </span>
              </span>
              <span className="mt-1.5 text-center text-[11.5px] font-semibold text-clay-ink">{stop.label}</span>
              <span className="text-center text-[10.5px] text-clay-muted">{stop.sub}</span>
              {onStop && (
                <button
                  type="button"
                  onClick={() => onStop(stop.id)}
                  aria-label={`Show ${stop.label}: ${counts[stop.id]} ${stop.sub}`}
                  className="absolute inset-0 rounded-xl hover:bg-clay-lavender/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay-lavender"
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const BADGE_ICON: Record<BadgeId, LucideIcon> = { ten: Trophy, six: Flame, three: Star, samples: Package, clean: Sparkles, owner: Crown };

export function BadgeGrid({ badges, fresh }: { badges: Badge[]; fresh: ReadonlySet<BadgeId> }) {
  const got = badges.filter(b => b.unlocked).length;
  return (
    <section aria-labelledby="badge-head" className="min-w-0 rounded-2xl border border-clay-hairline bg-white p-4 dark:bg-clay-card" data-testid="badges">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="badge-head" className="text-[15px] font-semibold text-clay-ink">Badges</h2>
        <span className="text-xs text-clay-muted">{got} of {badges.length}</span>
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {badges.map(b => {
          const Icon = BADGE_ICON[b.id];
          const isNew = fresh.has(b.id);
          return (
            <li
              key={b.id}
              data-badge={b.id}
              data-unlocked={b.unlocked || undefined}
              className={clsx(
                'flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1.5 pb-2.5 pt-3 text-center',
                b.unlocked ? 'bg-clay-surface dark:bg-clay-hairline/40' : 'border border-dashed border-clay-hairline dark:border-clay-muted-soft/40',
                isNew && 'lp-shine',
              )}
            >
              <span className={clsx('mb-1 grid h-10 w-10 place-items-center rounded-full', b.unlocked ? 'bg-clay-ochre/15 text-clay-ochre' : 'bg-clay-canvas text-clay-muted-soft', isNew && 'lp-medal')}>
                <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
              </span>
              <b className={clsx('text-[12.5px] font-semibold', b.unlocked ? 'text-clay-ink' : 'text-clay-muted')}>{b.name}</b>
              <span className="text-[11px] leading-tight text-clay-muted">{b.desc}</span>
              {b.unlocked && b.got && <span className="text-[11px] font-medium text-clay-ink/80">{b.got}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const RULES: [string, string][] = [
  ['First message, follow-up or nudge', `${POINTS.touch}`],
  ['Reach the owner or decision maker', `+${POINTS.owner}`],
  ['Check in with a regular', `${POINTS.regular}`],
  ['Buyer replies', `${POINTS.reply}`],
  ['Send a sample', `${POINTS.sample}`],
  ['Testing starts', `${POINTS.testing}`],
  ['Deal won', `${POINTS.won}`],
  ['Notes and edits', '0'],
];

export function PointsRules() {
  return (
    <details className="group min-w-0 rounded-2xl border border-clay-hairline bg-white dark:bg-clay-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 text-[15px] font-semibold text-clay-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender [&::-webkit-details-marker]:hidden">
        How points work
        <ChevronDown className="h-4 w-4 shrink-0 text-clay-muted transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-clay-hairline px-4 pb-3.5 pt-1">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {RULES.map(([what, pts]) => (
              <tr key={what} className="border-b border-clay-hairline last:border-b-0">
                <td className="py-1.5 text-clay-body">{what}</td>
                <td className={clsx('zams-mono py-1.5 text-right text-xs', pts === '0' ? 'text-clay-muted-soft' : 'text-clay-ink')}>{pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[12.5px] text-clay-muted">
          {RUN_SIZE} touches finish today&apos;s run. Any day with a touch adds a day to your streak, and Saturday and Sunday never break it. Points only come from steps that reach a buyer.
        </p>
      </div>
    </details>
  );
}
