'use client';

// ─── This week's game bar: today's run, the streak, touches per week, the month goal ───
// The summary that comes first. Numbers count up when they change; the run bar fills
// segment by segment and shines when full; the flame lights on the first touch of the
// day; this week's bar turns gold with a crown when it beats the best week.

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Crown } from 'lucide-react';
import * as crm from '@/lib/crm';
import ActionButton from '@/components/ActionButton';
import { formatBaht } from '@/utils/format';
import { RUN_SIZE, dayMonth, dayRange, monthName, weekdayDayMonth, type Streak, type WeekCount } from '@/utils/game';

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender';
const label = 'text-[11px] font-semibold uppercase tracking-[0.07em] text-clay-muted';
const big = 'zams-mono text-[26px] leading-none tabular-nums text-clay-ink';
const sub = 'text-xs leading-snug text-clay-muted';

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that counts from its last value to the new one. */
export function Ticker({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || reduced() || typeof requestAnimationFrame !== 'function') { setShown(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 480);
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{shown}</span>;
}

export function Flame({ lit, igniteKey }: { lit: boolean; igniteKey: number }) {
  return (
    <svg
      key={igniteKey}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-lit={lit || undefined}
      className={clsx('h-[26px] w-[26px] shrink-0 overflow-visible', lit && (igniteKey > 0 ? 'lp-ignite' : 'lp-flame-lit'))}
    >
      <defs>
        <linearGradient id="lp-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="var(--color-clay-coral)" />
          <stop offset="1" stopColor="var(--color-clay-ochre)" />
        </linearGradient>
      </defs>
      <path
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
        fill={lit ? 'url(#lp-flame)' : 'none'}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={lit ? 'stroke-clay-coral' : 'stroke-clay-muted-soft'}
      />
    </svg>
  );
}

export interface MonthGoal {
  /** 'YYYY-MM-01' */
  month: string;
  goal: number | null;
  won: number;
  wonDeals: number;
}

export interface GameBarProps {
  touchesToday: number;
  streak: Streak;
  weeks: WeekCount[];
  /** the best week before this one */
  bestBefore: number;
  weekPoints: number;
  goal: MonthGoal | null;
  /** the goal could not be read */
  goalFailed?: boolean;
  lastMonth: MonthGoal | null;
  onGoalSaved: (amount: number) => void;
  onRunClick: () => void;
  /** bumped when that win happens, to replay its animation */
  pulse: { run: number; streak: number; best: number; won: number };
  /** refs the win effects start from */
  anchors?: { streak?: (el: HTMLElement | null) => void; run?: (el: HTMLElement | null) => void; points?: (el: HTMLElement | null) => void; goal?: (el: HTMLElement | null) => void };
}

function RunCell({ touches, pulse, onClick, anchor }: { touches: number; pulse: number; onClick: () => void; anchor?: (el: HTMLElement | null) => void }) {
  const done = Math.min(touches, RUN_SIZE);
  const full = touches >= RUN_SIZE;
  const left = RUN_SIZE - done;
  return (
    <button type="button" onClick={onClick} ref={anchor} className={clsx('flex min-w-0 flex-col gap-2 p-4 text-left', focusRing)} aria-label={`Today's run: ${done} of ${RUN_SIZE} touches`}>
      <span className={label}>Today&apos;s run</span>
      <span className={big}><Ticker value={done} /><span className="ml-0.5 text-[17px] text-clay-muted-soft">/{RUN_SIZE}</span></span>
      <span className="grid grid-cols-5 gap-1" aria-hidden="true" data-testid="run-segments">
        {Array.from({ length: RUN_SIZE }, (_, i) => (
          <span
            key={`${i}-${full ? pulse : 0}`}
            className={clsx('relative h-2 overflow-hidden rounded-full bg-clay-surface dark:bg-clay-hairline/60', full && pulse > 0 && 'lp-seg-shine lp-wave')}
            style={full && pulse > 0 ? { animationDelay: `${i * 70}ms` } : undefined}
          >
            <span
              className={clsx('absolute inset-0 origin-left rounded-full transition-[transform,background-color] duration-500 ease-out', full ? 'bg-clay-mint' : 'bg-clay-lavender')}
              style={{ transform: `scaleX(${i < done ? 1 : 0})`, transitionDelay: `${i * 40}ms` }}
            />
          </span>
        ))}
      </span>
      <span className={sub}>
        {full ? (touches > RUN_SIZE ? `Run done, plus ${touches - RUN_SIZE} extra` : 'Run done. Anything more still counts.') : touches === 0 ? `${RUN_SIZE} touches finish today's run` : `${left} more to finish today's run`}
      </span>
    </button>
  );
}

function StreakCell({ streak, pulse, anchor }: { streak: Streak; pulse: number; anchor?: (el: HTMLElement | null) => void }) {
  const lit = streak.current > 0;
  return (
    <div className="flex min-w-0 flex-col gap-2 p-4" data-testid="streak-cell">
      <span className={label}>Streak</span>
      <span className={clsx(big, 'flex items-center gap-2')}>
        <span ref={anchor} className="inline-flex"><Flame lit={lit} igniteKey={pulse} /></span>
        <span key={pulse} className={pulse > 0 ? 'lp-roll' : undefined}>{streak.current}</span>
        <span className="font-sans text-sm text-clay-muted">{streak.current === 1 ? 'day' : 'days'}</span>
      </span>
      <span className={sub}>
        {streak.best > 0 && streak.bestFrom && streak.bestTo ? <>Best: {streak.best} {streak.best === 1 ? 'day' : 'days'}, {dayRange(streak.bestFrom, streak.bestTo)}<br /></> : null}
        {streak.litToday ? 'Touched today' : streak.lastTouch ? `Last touch: ${weekdayDayMonth(streak.lastTouch)}` : 'Log a touch to start one'}
      </span>
    </div>
  );
}

function WeekCell({ weeks, bestBefore, weekPoints, pulse, anchor }: { weeks: WeekCount[]; bestBefore: number; weekPoints: number; pulse: number; anchor?: (el: HTMLElement | null) => void }) {
  const now = weeks.at(-1)?.count ?? 0;
  const max = Math.max(1, bestBefore, ...weeks.map(w => w.count));
  const record = bestBefore > 0 && now > bestBefore;
  return (
    <div className="flex min-w-0 flex-col gap-2 p-4" data-testid="week-cell">
      <span className={label}>Touches per week</span>
      <span className="relative flex h-[46px] items-end gap-1" role="img" aria-label={`This week: ${now} touches. Best week before: ${bestBefore}.`}>
        {weeks.map((w, i) => {
          const isNow = i === weeks.length - 1;
          const gold = (!isNow && w.count > 0 && w.count === bestBefore) || (isNow && record);
          return (
            <span key={w.start} className="relative flex h-full flex-1 items-end" title={`${isNow ? 'This week' : `Week of ${dayMonth(w.start)}`}: ${w.count}`}>
              <span
                className={clsx('lp-grow-y w-full rounded-t-[3px] rounded-b-[1px] transition-[height,background-color] duration-500 ease-out', gold ? 'bg-clay-ochre' : isNow ? 'bg-clay-lavender' : 'bg-clay-hairline dark:bg-clay-muted-soft/50')}
                style={{ height: `${Math.max(4, (w.count / max) * 100)}%`, animationDelay: `${i * 35}ms` }}
              />
              {isNow && record && <Crown key={pulse} className="lp-crown absolute -top-4 left-1/2 h-3.5 w-3.5 text-clay-ochre" aria-hidden="true" />}
            </span>
          );
        })}
      </span>
      <span className="-mt-1 flex justify-between text-[10.5px] text-clay-muted-soft"><span>{weeks[0] ? dayMonth(weeks[0].start) : ''}</span><span>This week</span></span>
      <span className={sub}>
        <span ref={anchor} className="relative inline-block font-semibold text-clay-ink"><Ticker value={weekPoints} /> pts</span> this week{bestBefore > 0 ? ` · best week ${bestBefore}` : ''}
      </span>
    </div>
  );
}

function GoalCell({ goal, failed: loadFailed, lastMonth, onSaved, pulse, anchor }: { goal: MonthGoal | null; failed?: boolean; lastMonth: MonthGoal | null; onSaved: (n: number) => void; pulse: number; anchor?: (el: HTMLElement | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!goal) {
    return (
      <div className="flex min-w-0 flex-col gap-2 p-4" data-testid="goal-cell">
        <span className={label}>Month goal</span>
        <span className={sub}>{loadFailed ? 'The goal didn’t load.' : 'Loading…'}</span>
      </div>
    );
  }
  const name = monthName(goal.month);
  const amount = Number(draft.replace(/,/g, ''));
  const valid = draft.trim() !== '' && Number.isFinite(amount) && amount > 0;
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await crm.setSalesGoal(goal.month, amount);
      onSaved(amount);
      setEditing(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  const pct = goal.goal ? Math.min(100, (goal.won / goal.goal) * 100) : 0;
  const lastPct = lastMonth?.goal ? Math.min(100, (lastMonth.won / lastMonth.goal) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-2 p-4" ref={anchor} data-testid="goal-cell">
      <span className={label}>{name} goal</span>
      {editing ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <input
            inputMode="numeric"
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false); }}
            aria-label={`Revenue goal for ${name} in baht`}
            placeholder="e.g. 50000"
            className="h-8 w-28 rounded-lg border border-clay-hairline bg-transparent px-2 text-sm text-clay-ink focus:outline-none focus:ring-2 focus:ring-clay-lavender/40"
          />
          <ActionButton busy={saving} disabled={!valid} onClick={save}>Save</ActionButton>
          {failed && <span role="alert" className="text-xs text-clay-error">Could not save.</span>}
        </span>
      ) : goal.goal === null ? (
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="whitespace-nowrap text-[17px] font-semibold text-clay-ink">Not set</span>
          <button type="button" onClick={() => { setDraft(lastMonth?.goal ? String(lastMonth.goal) : ''); setEditing(true); }} className={clsx('h-7 whitespace-nowrap rounded-lg border border-clay-hairline px-2.5 text-xs font-medium text-clay-ink hover:border-clay-lavender', focusRing)}>
            Set goal
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => { setDraft(String(goal.goal)); setEditing(true); }} className={clsx('flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-left', focusRing)} aria-label={`${name} goal: ${formatBaht(goal.won)} won of ${formatBaht(goal.goal)}. Change`}>
          <span className={clsx(big, 'text-[22px]')}>{formatBaht(goal.won)}</span>
          <span className="text-xs text-clay-muted">of {formatBaht(goal.goal)}</span>
        </button>
      )}
      <span className="h-2 overflow-hidden rounded-full bg-clay-surface dark:bg-clay-hairline/60" role="img" aria-label={goal.goal ? `${Math.round(pct)}% of the goal` : lastMonth?.goal ? `${monthName(lastMonth.month)}: ${Math.round(lastPct)}% of its goal` : 'No goal yet'}>
        <span
          key={pulse}
          className={clsx('block h-full rounded-full transition-[width] duration-700 ease-out', goal.goal ? 'bg-clay-success' : 'bg-clay-muted-soft/60', pulse > 0 && goal.goal && 'lp-glow')}
          style={{ width: `${goal.goal ? pct : lastPct}%` }}
        />
      </span>
      <span className={sub}>
        {goal.goal
          ? (goal.won >= goal.goal ? `Goal met · ${goal.wonDeals} won` : `${formatBaht(goal.goal - goal.won)} to go · ${goal.wonDeals} won`)
          : lastMonth?.goal
            ? `${monthName(lastMonth.month)}: ${formatBaht(lastMonth.won)} won of ${formatBaht(lastMonth.goal)} · ${lastMonth.wonDeals} won`
            : `${formatBaht(goal.won)} won so far`}
      </span>
    </div>
  );
}

export default function GameBar(props: GameBarProps) {
  return (
    <section
      aria-label="Your progress"
      data-testid="game-bar"
      className="grid grid-cols-2 overflow-hidden rounded-2xl border border-clay-hairline bg-white dark:bg-clay-card lg:grid-cols-[1.05fr_1fr_1.45fr_1.25fr] [&>*]:border-clay-hairline max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(2n)]:border-l lg:[&>*+*]:border-l"
    >
      <RunCell touches={props.touchesToday} pulse={props.pulse.run} onClick={props.onRunClick} anchor={props.anchors?.run} />
      <StreakCell streak={props.streak} pulse={props.pulse.streak} anchor={props.anchors?.streak} />
      <WeekCell weeks={props.weeks} bestBefore={props.bestBefore} weekPoints={props.weekPoints} pulse={props.pulse.best} anchor={props.anchors?.points} />
      <GoalCell goal={props.goal} failed={props.goalFailed} lastMonth={props.lastMonth} onSaved={props.onGoalSaved} pulse={props.pulse.won} anchor={props.anchors?.goal} />
    </section>
  );
}
