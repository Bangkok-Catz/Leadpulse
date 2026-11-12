'use client';

// ─── This week: today's run, Up next and Done today ───
// One bold line per step: who, then what to do. Under it, only what tells you something:
// how late (red is only ever lateness), the channel, and Details for the rest. Finishing a
// step ticks it off: the row flashes mint, its tick draws, "+points" floats up and a small
// burst pops, then the row folds away and lands in Done today.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, PenLine, Trophy, type LucideIcon } from 'lucide-react';
import CompanyLogo from '@/components/CompanyLogo';
import { useCelebrate } from '@/components/game/Celebrate';
import { RUN_SIZE, isQuestDone, type DoneEntry, type Quest, type QuestKind } from '@/utils/game';
import { QUICK, type QuickKind } from '@/utils/quick-log';

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender';

export interface QuestView extends Quest {
  logoUrl?: string | null;
  channel: { icon: LucideIcon; label: string } | null;
  /** a calm word under the name: "Replied", "At risk", "New lead" */
  tag: string | null;
  /** shown when Details is opened */
  detail: ReactNode;
  href: string | null;
  /** what the row's button does; without it the row links to `href` with Open */
  onDone?: () => void;
  /** spoken name for the button */
  doneLabel: string;
  busy?: boolean;
  /** one-tap logging: the button names what Pat did; ▾ holds the other ways and the full form */
  quick?: {
    primary: QuickKind;
    others: QuickKind[];
    onLog: (kind: QuickKind, words?: string) => void;
    onForm?: () => void;
  };
  /** the message for this step, opened under the row by Write; `close` folds it after logging */
  message?: (close: () => void) => ReactNode;
}

type Shown = { quest: QuestView; ghost: boolean; points: number };

/** Keeps a just-finished step on screen for a moment so its tick can play, then lets it go. */
function useGhosts(list: QuestView[], done: DoneEntry[], primed: boolean): Shown[] {
  const prev = useRef<QuestView[]>(list);
  const [ghosts, setGhosts] = useState<{ quest: QuestView; index: number; points: number; until: number }[]>([]);

  useEffect(() => {
    const before = prev.current;
    prev.current = list;
    if (!primed) return;
    const now = new Set(list.map(q => q.key));
    const gone = before
      .map((quest, index) => ({ quest, index }))
      .filter(({ quest }) => !now.has(quest.key) && isQuestDone(quest, done));
    if (gone.length === 0) return;
    const until = Date.now() + 950;
    setGhosts(g => [
      ...g.filter(x => !gone.some(n => n.quest.key === x.quest.key)),
      ...gone.map(({ quest, index }) => ({
        quest, index, until,
        points: done.filter(d => (quest.dealId ? d.dealId === quest.dealId : d.companyId === quest.companyId)).reduce((s, d) => s + d.points, 0) || quest.points,
      })),
    ]);
  }, [list, done, primed]);

  // Let each ghost go once its tick has played.
  useEffect(() => {
    if (ghosts.length === 0) return;
    const wait = Math.max(0, Math.min(...ghosts.map(g => g.until)) - Date.now());
    const timer = setTimeout(() => setGhosts(g => g.filter(x => x.until > Date.now() + 20)), wait + 30);
    return () => clearTimeout(timer);
  }, [ghosts]);

  return useMemo(() => {
    const out: Shown[] = list.map(quest => ({ quest, ghost: false, points: quest.points }));
    for (const g of [...ghosts].sort((a, b) => a.index - b.index)) {
      if (out.some(s => s.quest.key === g.quest.key)) continue;
      out.splice(Math.min(g.index, out.length), 0, { quest: g.quest, ghost: true, points: g.points });
    }
    return out;
  }, [list, ghosts]);
}

function QuestRow({ shown }: { shown: Shown }) {
  const { quest: q, ghost, points } = shown;
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [writing, setWriting] = useState(false);
  const [words, setWords] = useState('');
  const chip = useRef<HTMLSpanElement | null>(null);
  const { fire } = useCelebrate();
  useEffect(() => { if (ghost) fire('burst', chip.current); }, [ghost, fire]);
  const Icon = q.channel?.icon;
  const detailId = `quest-${q.key.replace(/[^a-z0-9-]/gi, '-')}`;
  const choicesId = `${detailId}-ways`;
  const writeId = `${detailId}-write`;
  const pick = (kind: QuickKind) => {
    setChoosing(false);
    setWriting(false);
    if (kind === 'reply') { setReplying(true); return; }
    q.quick?.onLog(kind);
  };

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } }}
      className="overflow-hidden border-t border-clay-hairline first:border-t-0"
      data-testid="quest-row"
      data-kind={q.kind}
    >
      <div className={clsx('flex items-start gap-3 rounded-xl px-1.5 py-2.5', ghost && 'lp-ticking')}>
        <span className="mt-0.5 shrink-0"><CompanyLogo src={q.logoUrl} name={q.name} id={q.companyId ?? undefined} size={34} /></span>
        {/* The step on the left; its points and button beside it, or under it when the row is narrow. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[12rem] flex-1">
          <p className="text-[14.5px] leading-snug text-clay-ink">
            {q.href ? (
              <Link href={q.href} className={clsx('font-bold hover:text-clay-lavender', focusRing)}>{q.name}</Link>
            ) : <b className="font-bold">{q.name}</b>}
            <span className="max-sm:block"><span className="mx-1.5 text-clay-muted-soft max-sm:hidden" aria-hidden="true">·</span>{q.action}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-clay-muted">
            {q.late > 0 && <span className="font-semibold text-clay-error">{q.late}d late</span>}
            {q.held && <span className="font-semibold text-clay-error">On hold — check before contacting</span>}
            {q.tag && <span>{q.tag}</span>}
            {q.channel && Icon && <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{q.channel.label}</span>}
            {q.detail && (
              <button type="button" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(v => !v)} className={clsx('inline-flex items-center gap-0.5 hover:text-clay-ink', focusRing)}>
                Details<ChevronDown className={clsx('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
              </button>
            )}
            {!ghost && q.message && !q.held && (
              <button
                type="button"
                onClick={() => { setWriting(v => !v); setChoosing(false); setReplying(false); }}
                aria-expanded={writing}
                aria-controls={writeId}
                aria-label={`Write a message to ${q.name}`}
                className={clsx('inline-flex items-center gap-1 font-medium', writing ? 'text-clay-ink' : 'text-clay-lavender hover:text-clay-ink', focusRing)}
              >
                <PenLine className="h-3.5 w-3.5" aria-hidden="true" />Write
              </button>
            )}
          </p>
          {open && q.detail && <div id={detailId} className="mt-2 rounded-lg bg-clay-surface px-2.5 py-2 text-[12.5px] leading-relaxed text-clay-body dark:bg-clay-hairline/40">{q.detail}</div>}
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-3">
        {points > 0 && (
          <span ref={chip} className="zams-mono relative shrink-0 rounded-md bg-clay-lavender/20 px-1.5 py-1 text-[11.5px] text-clay-ink" aria-label={`${points} points`}>
            +{points}
            {ghost && <span className="lp-float zams-mono text-sm font-semibold text-clay-success" aria-hidden="true">+{points}</span>}
          </span>
        )}
        {ghost ? (
          <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-clay-mint px-3 text-[13px] font-semibold text-[#10311f]" role="status">
            <svg viewBox="0 0 24 24" className="lp-check-in h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            <span className="max-sm:sr-only">Done</span>
          </span>
        ) : q.quick && !q.held ? (
          <span className="inline-flex h-9 shrink-0 overflow-hidden rounded-[10px] bg-clay-ink text-clay-canvas">
            <button
              type="button"
              onClick={() => q.quick?.onLog(q.quick.primary)}
              disabled={q.busy}
              aria-label={q.doneLabel}
              className={clsx('inline-flex items-center gap-1.5 pl-3 pr-2.5 text-[13px] font-semibold transition-transform duration-150 active:scale-95 disabled:opacity-60', focusRing)}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {QUICK[q.quick.primary].label}
            </button>
            <button
              type="button"
              onClick={() => { setChoosing(v => !v); setReplying(false); setWriting(false); }}
              disabled={q.busy}
              aria-expanded={choosing}
              aria-controls={choicesId}
              aria-label={`Other ways to log ${q.name}`}
              className={clsx('inline-flex items-center border-l border-clay-canvas/20 px-2 disabled:opacity-60', focusRing)}
            >
              <ChevronDown className={clsx('h-4 w-4 transition-transform duration-200', choosing && 'rotate-180')} aria-hidden="true" />
            </button>
          </span>
        ) : q.onDone && !q.held ? (
          <button
            type="button"
            onClick={q.onDone}
            disabled={q.busy}
            aria-label={q.doneLabel}
            className={clsx('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-clay-ink px-3 text-[13px] font-semibold text-clay-canvas transition-transform duration-150 active:scale-95 disabled:opacity-60', focusRing)}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Done</span>
          </button>
        ) : q.href ? (
          <Link href={q.href} aria-label={q.doneLabel} className={clsx('inline-flex h-9 shrink-0 items-center rounded-[10px] border border-clay-hairline px-3 text-[13px] font-medium text-clay-ink hover:border-clay-lavender', focusRing)}>
            Open
          </Link>
        ) : null}
        </span>
        </div>
      </div>
      {!ghost && q.quick && choosing && (
        <div id={choicesId} role="group" aria-label={`Other ways to log ${q.name}`} className="flex flex-wrap gap-1.5 pb-2.5 pl-[52px] pr-1.5">
          {q.quick.others.map(kind => (
            <button key={kind} type="button" onClick={() => pick(kind)} className={clsx('rounded-lg border border-clay-hairline px-2.5 py-1 text-[12.5px] font-medium text-clay-ink hover:border-clay-lavender hover:bg-clay-lavender/10', focusRing)}>
              {QUICK[kind].label}
            </button>
          ))}
          {q.quick.onForm && (
            <button type="button" onClick={() => { setChoosing(false); q.quick?.onForm?.(); }} className={clsx('rounded-lg px-2.5 py-1 text-[12.5px] font-medium text-clay-muted underline decoration-clay-hairline underline-offset-2 hover:text-clay-ink', focusRing)}>
              Full log form
            </button>
          )}
        </div>
      )}
      {!ghost && q.message && writing && (
        <div id={writeId} className="mb-3 ml-[46px] mr-1.5 rounded-xl border border-clay-hairline bg-clay-surface/60 p-3 dark:bg-clay-hairline/30" data-testid="row-message">
          {q.message(() => setWriting(false))}
        </div>
      )}
      {!ghost && q.quick && replying && (
        <div className="grid gap-2 pb-3 pl-[52px] pr-1.5">
          <label htmlFor={`${detailId}-reply`} className="sr-only">Their words</label>
          <textarea
            id={`${detailId}-reply`}
            value={words}
            onChange={event => setWords(event.target.value)}
            rows={2}
            autoFocus
            placeholder="Paste their words (optional). LeadPulse reads them for questions."
            className="w-full rounded-lg border border-clay-hairline bg-transparent px-3 py-2 text-sm text-clay-ink placeholder:text-clay-muted focus:outline-none focus:ring-2 focus:ring-clay-lavender/40"
          />
          <div className="flex gap-2">
            <button type="button" disabled={q.busy} onClick={() => { q.quick?.onLog('reply', words); setReplying(false); setWords(''); }} className={clsx('rounded-[10px] bg-clay-ink px-3 py-1.5 text-[13px] font-semibold text-clay-canvas disabled:opacity-60', focusRing)}>
              Save reply
            </button>
            <button type="button" onClick={() => { setReplying(false); setWords(''); }} className={clsx('rounded-[10px] border border-clay-hairline px-3 py-1.5 text-[13px] text-clay-ink', focusRing)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </motion.li>
  );
}

function List({ items, label }: { items: Shown[]; label: string }) {
  return (
    <ol aria-label={label} className="m-0 list-none p-0">
      <AnimatePresence initial={false}>
        {items.map(s => <QuestRow key={s.quest.key} shown={s} />)}
      </AnimatePresence>
    </ol>
  );
}

type Filter = 'all' | 'late' | QuestKind;

const FILTERS: { id: Filter; label: string; test: (q: Quest) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'late', label: 'Late', test: q => q.late > 0 },
  { id: 'reply', label: 'Replies', test: q => q.kind === 'reply' },
  { id: 'due', label: 'This week', test: q => q.kind === 'due' },
  { id: 'checkin', label: 'Check-ins', test: q => q.kind === 'checkin' },
  { id: 'lead', label: 'Leads', test: q => q.kind === 'lead' },
  { id: 'undated', label: 'No date', test: q => q.kind === 'undated' },
  { id: 'funding', label: 'Funding', test: q => q.kind === 'funding' },
];

const PREVIEW = 6;

export default function QuestList({ run, next, done, touchesToday, primed, runPulse, footnote, decisions, quiet = false }: {
  run: QuestView[];
  next: QuestView[];
  done: DoneEntry[];
  touchesToday: number;
  /** after the first load, so nothing ticks off on arrival */
  primed: boolean;
  /** bumped when today's run is finished */
  runPulse: number;
  footnote?: ReactNode;
  /** decisions to make before anything else */
  decisions?: ReactNode;
  /** the data failed to load: say nothing rather than claim an empty list */
  quiet?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  const runShown = useGhosts(run, done, primed);
  const chips = FILTERS.map(f => ({ ...f, count: f.id === 'all' ? next.length : next.filter(f.test).length })).filter(f => f.id === 'all' || f.count > 0);
  const active = chips.some(c => c.id === filter) ? filter : 'all';
  const filtered = next.filter(FILTERS.find(f => f.id === active)!.test);
  const visible = showAll || active !== 'all' ? filtered : filtered.slice(0, PREVIEW);
  const nextShown = useGhosts(visible, done, primed);
  const finished = touchesToday >= RUN_SIZE;
  const points = done.reduce((s, d) => s + d.points, 0);

  return (
    <section id="follow-ups" aria-labelledby="run-head" className="min-w-0 scroll-mt-4 rounded-2xl border border-clay-hairline bg-white p-4 dark:bg-clay-card">
      {decisions}
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 id="run-head" className="text-[15px] font-semibold text-clay-ink">Today&apos;s run</h2>
        <span className="text-xs text-clay-muted">Biggest steps first</span>
      </div>

      {finished && runShown.length === 0 ? (
        <div key={runPulse} className={clsx('flex items-center gap-2.5 rounded-xl bg-clay-mint/20 px-3 py-3 text-[13px] font-medium text-clay-ink', runPulse > 0 && 'lp-drop-in lp-shine')} role="status" data-testid="run-done">
          <Trophy className={clsx('h-5 w-5 shrink-0 text-clay-ochre', runPulse > 0 && 'lp-medal')} aria-hidden="true" />
          Run done{touchesToday > RUN_SIZE ? `, plus ${touchesToday - RUN_SIZE} extra` : ''}. Anything under Up next still counts.
        </div>
      ) : runShown.length === 0 ? (
        quiet ? null : <p className="rounded-xl bg-clay-surface px-3 py-3 text-[13px] text-clay-muted dark:bg-clay-hairline/40">{next.length === 0 && done.length === 0 ? 'Nothing due this week.' : 'Nothing else for the run today.'}</p>
      ) : (
        <List items={runShown} label="Today's run" />
      )}

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-clay-muted">Up next</h3>
        <span className="text-xs text-clay-muted">Each one still counts</span>
      </div>
      {next.length > 0 && (
        <div role="tablist" aria-label="Show" className="no-scrollbar -mx-1 mt-1.5 mb-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {chips.map(c => (
            <button
              key={c.id}
              role="tab"
              aria-selected={active === c.id}
              onClick={() => { setFilter(c.id); setShowAll(false); }}
              className={clsx(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors',
                active === c.id ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
                focusRing,
              )}
            >
              {c.label}
              <span className={clsx('text-xs tabular-nums', c.id === 'late' ? 'font-semibold text-clay-error' : 'text-clay-muted')}>{c.count}</span>
            </button>
          ))}
        </div>
      )}
      {nextShown.length === 0 ? (
        quiet ? null : <p className="px-1 py-3 text-[13px] text-clay-muted">Nothing else waiting.</p>
      ) : (
        <List items={nextShown} label="Up next" />
      )}
      {active === 'all' && filtered.length > PREVIEW && (
        <button type="button" onClick={() => setShowAll(v => !v)} className={clsx('mt-1 h-8 rounded-sm text-xs font-medium text-clay-lavender', focusRing)}>
          {showAll ? 'Show fewer' : `Show all ${filtered.length}`}
        </button>
      )}
      {footnote}

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-clay-muted">Done today</h3>
        {done.length > 0 && <span className="text-xs text-clay-muted">{touchesToday} {touchesToday === 1 ? 'touch' : 'touches'} · {points} pts</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="done-today">
        {done.length === 0 ? (
          <span className="text-[12.5px] text-clay-muted-soft">Nothing yet. Each step you finish lands here.</span>
        ) : (
          <AnimatePresence initial={false}>
            {done.map(d => (
              <motion.span key={d.key} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 22 }}>
                <Link
                  href={d.dealId ? `/deals?deal=${encodeURIComponent(d.dealId)}` : d.companyId ? `/companies?company=${encodeURIComponent(d.companyId)}` : '#'}
                  className={clsx('inline-flex items-center gap-1.5 rounded-lg bg-clay-mint/20 px-2 py-1 text-[12.5px] text-clay-ink hover:bg-clay-mint/30', focusRing)}
                >
                  <Check className="h-3.5 w-3.5 text-clay-success" aria-hidden="true" />
                  {d.name}
                  {d.points > 0 && <span className="zams-mono text-[11px] text-clay-muted">+{d.points}</span>}
                </Link>
              </motion.span>
            ))}
          </AnimatePresence>
        )}
      </div>
    </section>
  );
}
