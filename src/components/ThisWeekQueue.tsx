'use client';

// ─── This week, as a game ───
// The game bar comes first (today's run, the streak, touches per week, the month goal).
// Then today's run: five steps, biggest first, every one a single bold line; Up next holds
// the rest, filterable; Done today collects what's finished. Beside it, the board (deals
// moving toward Won), badges and how points work. Everything is read from what is logged
// (utils/game.ts), so the game never disagrees with the CRM. Wins are celebrated as they
// happen: a tick and "+points" per step, embers when the streak grows, confetti when the
// run is done, gold for a badge or a best week, coins for a deal won.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Building2, HeartHandshake, Inbox, Landmark, Mail, MessageCircle, Package, Phone, Search, Users, type LucideIcon } from 'lucide-react';
import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import * as crm from '@/lib/crm';
import RecentChanges from '@/components/RecentChanges';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import { useCelebrate } from '@/components/game/Celebrate';
import GameBar, { type MonthGoal } from '@/components/game/GameBar';
import QuestList, { type QuestView } from '@/components/game/QuestList';
import { LoggedNote, useQuickLog } from '@/components/game/QuickLog';
import { BadgeGrid, GameBoard, PointsRules, type BoardToken } from '@/components/game/GameBoard';
import { LeadTools, ROUTE_ICON, useLeadActions } from '@/components/LeadActions';
import ReachOutSweep, { useSweepCount } from '@/components/ReachOutSweep';
import type { BlobState } from '@/components/blob';
import { useLayaGrades } from '@/hooks/useLayaReviewList';
import { WORKFLOW_BY_ID, addDaysToDateKey, getWorkflowAction } from '@/utils/deal-workflow';
import { buildDoNext } from '@/utils/do-next';
import { formatBaht } from '@/utils/format';
import {
  POINTS, RUN_SIZE, badges as readBadges, bestWeek, boardCounts, doneToday, gameEvents, isQuestDone, laneWins,
  pickRun, pointsBetween, pointsContext, stopOf, streak as readStreak, touchesByDay,
  weekStart, weeklyTouches, type BadgeId, type GameSnapshot,
} from '@/utils/game';
import { goalProgress, monthStart } from '@/utils/goal-progress';
import type { GrowthDue } from '@/utils/growth';
import { laneTimelines } from '@/utils/lane-time';
import type { TodaysLeads } from '@/utils/prospecting';
import type { ThisWeekQueue as Queue } from '@/utils/this-week-queue';
import { QUICK } from '@/utils/quick-log';
import { WAITING_KINDS, buildQuestSeeds, shortDate, type SeedChannel } from '@/utils/quests';

interface ThisWeekQueueProps {
  queue: Queue;
  today: string;
  deals: Deal[];
  companies: Company[];
  contacts: Contact[];
  meetings: Meeting[];
  loading: boolean;
  sourceError: boolean;
  accountEventsUnavailable: boolean;
  onRetry: () => void;
  onLogDeal: (dealId: string) => void;
  onLogCompany: (companyId: string) => void;
  /** after a one-tap check-in: moves the account's next check-in date; returns the old dates for Undo */
  onCheckIn?: (companyId: string) => Promise<Partial<Company> | null>;
  /** today's leads (utils/prospecting.ts) */
  leads?: TodaysLeads;
  /** funding steps that are late or due this week (Growth page) */
  growth?: GrowthDue;
  /** the mascot's mood: sleepy when the streak is cold, joyful on a win */
  onMood?: (state: BlobState) => void;
}

/** Icons for a step's channel (utils/quests.ts names them). */
const CHANNEL_ICON: Record<Exclude<SeedChannel['key'], 'route'>, LucideIcon> = {
  call: Phone, email: Mail, message: MessageCircle, meeting: Users, sample: Package, regular: HeartHandshake, funding: Landmark,
};

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender';

function DetailLines({ lines, link }: { lines: (string | null | undefined | false)[]; link?: { href: string; label: string } }) {
  const shown = lines.filter(Boolean) as string[];
  return (
    <>
      {shown.map((line, i) => <p key={i} className={i ? 'mt-1' : undefined}>{line}</p>)}
      {link && <Link href={link.href} className={clsx('mt-1.5 inline-block font-medium text-clay-ink underline decoration-clay-hairline underline-offset-2 hover:text-clay-lavender', focusRing)}>{link.label}</Link>}
    </>
  );
}

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function ThisWeekQueue({
  queue,
  today,
  deals,
  companies,
  contacts,
  meetings,
  loading,
  sourceError,
  accountEventsUnavailable,
  onRetry,
  onLogDeal,
  onLogCompany,
  onCheckIn,
  leads,
  growth,
  onMood,
}: ThisWeekQueueProps) {
  const { needsReview, overdue, dueThisWeek, checkIns, needsDate } = queue;
  const { activities = [] } = useCrm();
  const { addToast } = useToast();
  const { fire } = useCelebrate();
  const leadActions = useLeadActions(today);
  const quickLog = useQuickLog(today);
  const [sweepOpen, setSweepOpen] = useState(false);
  const sweepCount = useSweepCount();
  const { log: logQuick, busy: quickBusy } = quickLog;

  const dealsById = useMemo(() => new Map(deals.map(d => [d.id, d])), [deals]);
  const companiesById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies]);
  const timelines = useMemo(() => laneTimelines(deals, activities), [deals, activities]);
  const ctx = useMemo(() => pointsContext({ deals, companies, contacts }), [deals, companies, contacts]);

  /* ── The numbers ── */
  const days = useMemo(() => touchesByDay(meetings), [meetings]);
  const streak = useMemo(() => readStreak(days, today), [days, today]);
  const weeks = useMemo(() => weeklyTouches(days, today), [days, today]);
  const thisWeek = weekStart(today);
  const bestBefore = useMemo(() => bestWeek(new Map([...days].filter(([d]) => weekStart(d) !== thisWeek))).count, [days, thisWeek]);
  const wins = useMemo(() => laneWins(deals, timelines), [deals, timelines]);
  const weekPoints = useMemo(() => pointsBetween(meetings, wins, ctx, thisWeek, addDaysToDateKey(thisWeek, 6)), [meetings, wins, ctx, thisWeek]);
  const touchesToday = days.get(today) ?? 0;
  const done = useMemo(() => doneToday(meetings, today, ctx, {
    deal: id => { const d = dealsById.get(id); return (d?.company_id ? companiesById.get(d.company_id)?.name : null) ?? d?.client ?? d?.title ?? null; },
    company: id => companiesById.get(id)?.name ?? null,
  }), [meetings, today, ctx, dealsById, companiesById]);
  const counts = useMemo(() => boardCounts(deals, timelines, today), [deals, timelines, today]);
  const badgeList = useMemo(
    () => readBadges({ days, meetings, deals, timelines, ctx, late: overdue.length, today }),
    [days, meetings, deals, timelines, ctx, overdue.length, today],
  );

  /* ── Who's waiting on Pat ── */
  const { grades } = useLayaGrades(deals, meetings);
  const [now] = useState(() => Date.now());
  const waitingOnYou = useMemo(
    () => buildDoNext({ deals, meetings, grades, timelines, today, now }).filter(item => WAITING_KINDS.includes(item.reasons[0].kind)),
    [deals, meetings, grades, timelines, today, now],
  );
  const heldDealIds = useMemo(
    () => new Set([...needsReview, ...overdue, ...dueThisWeek, ...needsDate].filter(c => c.holds.length > 0 && c.dealId).map(c => c.dealId!)),
    [needsReview, overdue, dueThisWeek, needsDate],
  );

  /* ── Every step, as one list (utils/quests.ts), with its icon, details and buttons ── */
  const { log: logLead, park: parkLead, busy: leadBusy } = leadActions;
  const seeds = useMemo(() => buildQuestSeeds({
    waitingOnYou, queue: { overdue, dueThisWeek, needsDate, checkIns }, leads, growth, today, dealsById,
    companyName: id => (id ? companiesById.get(id)?.name : null), ctx, heldDealIds,
  }), [waitingOnYou, overdue, dueThisWeek, needsDate, checkIns, leads, growth, today, dealsById, companiesById, ctx, heldDealIds]);

  const quests = useMemo(() => seeds.map((seed): QuestView => {
    const { source } = seed;
    const logoUrl = source.type === 'lead' ? source.lead.company.logo_url : seed.companyId ? companiesById.get(seed.companyId)?.logo_url : null;
    const channel = seed.channel
      ? { icon: seed.channel.key === 'route' ? ROUTE_ICON[seed.channel.routeType] : CHANNEL_ICON[seed.channel.key], label: seed.channel.label }
      : null;
    const base = { ...seed, logoUrl, channel, busy: quickBusy === seed.key };
    const label = seed.quick ? QUICK[seed.quick.primary].label : 'Done';

    switch (source.type) {
      case 'waiting': {
        const { deal, reason } = source;
        const lane = WORKFLOW_BY_ID[getWorkflowAction(deal)]?.shortLabel;
        return {
          ...base,
          detail: <DetailLines lines={[seed.full !== seed.action ? seed.full : null, reason.label, lane && `Stage: ${lane}`, deal.value ? `Worth ${formatBaht(deal.value)}` : null]} link={{ href: seed.href!, label: 'Open deal' }} />,
          onDone: () => onLogDeal(deal.id), doneLabel: `${label}: log it for ${deal.title || seed.name}`,
          quick: seed.quick ? {
            ...seed.quick,
            onLog: (kind, words) => { void logQuick({ key: seed.key, name: seed.name, deal }, kind, words); },
            onForm: () => onLogDeal(deal.id),
          } : undefined,
        };
      }
      case 'followup': {
        const { item, deal, when, canLog } = source;
        const lane = deal ? WORKFLOW_BY_ID[getWorkflowAction(deal)]?.shortLabel : null;
        const title = item.dealTitle || seed.name;
        return {
          ...base,
          detail: <DetailLines
            lines={[
              seed.full !== seed.action ? seed.full : null,
              when === 'undated' ? 'Open the deal to set a follow-up date or park it.' : null,
              lane && `Stage: ${lane}`,
              deal?.value ? `Worth ${formatBaht(deal.value)}` : null,
              deal?.last_outcome ? `Last time: ${deal.last_outcome}` : null,
            ]}
            link={seed.href ? { href: seed.href, label: item.dealId ? 'Open deal' : 'Open account' } : undefined}
          />,
          onDone: canLog ? () => onLogDeal(item.dealId!) : undefined,
          doneLabel: canLog ? `${label}: log it for ${title}` : `Open: ${title}`,
          quick: seed.quick && deal ? {
            ...seed.quick,
            onLog: (kind, words) => { void logQuick({ key: seed.key, name: seed.name, deal }, kind, words); },
            onForm: () => onLogDeal(deal.id),
          } : undefined,
        };
      }
      case 'lead': {
        const { lead, owner, finished } = source;
        return {
          ...base,
          busy: leadBusy === lead.deal.id,
          detail: (
            <>
              {lead.fit != null && <p className="mb-1">Fit {Math.round(lead.fit * 100)}%</p>}
              {!owner && !finished && <p className="mb-1.5 font-medium text-clay-ink">+{POINTS.owner} more if you reach the owner</p>}
              <LeadTools lead={lead} today={today} contacts={contacts} busy={leadBusy === lead.deal.id} onLog={logLead} onPark={parkLead} />
            </>
          ),
          onDone: finished ? undefined : () => { void logLead(lead, lead.route.type); },
          doneLabel: finished ? `Open: ${lead.company.name}` : `${label}: log the touch for ${lead.company.name}`,
          quick: seed.quick ? {
            ...seed.quick,
            // The lead's own route keeps its contact; another channel is logged the same way.
            onLog: kind => { void logLead(lead, kind === seed.quick!.primary ? lead.route.type : QUICK[kind].type); },
            onForm: () => onLogDeal(lead.deal.id),
          } : undefined,
        };
      }
      case 'checkin': {
        const { row } = source;
        return {
          ...base,
          detail: <DetailLines lines={[row.reorder?.evidence, row.dueDate && seed.late === 0 ? `Check-in due ${shortDate(row.dueDate)}` : null]} link={{ href: seed.href!, label: 'Open account' }} />,
          onDone: () => onLogCompany(row.companyId), doneLabel: `${label}: log it for ${row.companyName}`,
          quick: seed.quick ? {
            ...seed.quick,
            onLog: kind => { void logQuick({ key: seed.key, name: row.companyName, companyId: row.companyId, after: onCheckIn && (() => onCheckIn(row.companyId)) }, kind); },
            onForm: () => onLogCompany(row.companyId),
          } : undefined,
        };
      }
      case 'funding':
        return { ...base, detail: null, doneLabel: `Open ${seed.name} on Growth`, quick: undefined };
    }
  }), [seeds, companiesById, quickBusy, leadBusy, today, contacts, logLead, parkLead, onLogDeal, onLogCompany, onCheckIn, logQuick]);

  const open = useMemo(() => quests.filter(q => !isQuestDone(q, done)), [quests, done]);
  const { run, next } = useMemo(() => {
    const picked = pickRun(open, Math.max(0, RUN_SIZE - touchesToday));
    return picked as { run: QuestView[]; next: QuestView[] };
  }, [open, touchesToday]);

  /* ── The board's faces: deals in today's run and the ones done today ── */
  const tokens = useMemo(() => {
    const ids = [...run.map(q => q.dealId), ...done.map(d => d.dealId)].filter((id): id is string => Boolean(id));
    const out: BoardToken[] = [];
    for (const id of new Set(ids)) {
      const deal = dealsById.get(id);
      const stop = deal ? stopOf(deal) : null;
      if (!deal || !stop) continue;
      const company = deal.company_id ? companiesById.get(deal.company_id) : undefined;
      out.push({ dealId: id, stop, name: company?.name || deal.client || deal.title, companyId: deal.company_id, logoUrl: company?.logo_url });
    }
    return out;
  }, [run, done, dealsById, companiesById]);

  /* ── The month goal ── */
  const month = monthStart(today);
  const lastMonthKey = monthStart(addDaysToDateKey(month, -1));
  const [goals, setGoals] = useState<{ cur: number | null; last: number | null } | 'error' | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => Promise.all([crm.getSalesGoal(month), crm.getSalesGoal(lastMonthKey)]))
      .then(([cur, last]) => { if (!cancelled) setGoals({ cur, last }); })
      .catch(() => { if (!cancelled) setGoals('error'); });
    return () => { cancelled = true; };
  }, [month, lastMonthKey]);
  const goal: MonthGoal | null = useMemo(() => {
    if (!goals || goals === 'error') return null;
    const p = goalProgress({ deals, timelines, today, goal: goals.cur });
    return { month, goal: goals.cur, won: p.won, wonDeals: p.wonDeals };
  }, [goals, deals, timelines, today, month]);
  const lastMonth: MonthGoal | null = useMemo(() => {
    if (!goals || goals === 'error') return null;
    const p = goalProgress({ deals, timelines, today: lastMonthKey, goal: goals.last });
    return { month: lastMonthKey, goal: goals.last, won: p.won, wonDeals: p.wonDeals };
  }, [goals, deals, timelines, lastMonthKey]);

  /* ── Wins: compare with the last snapshot and celebrate what changed ── */
  const anchors = useRef<Record<'streak' | 'run' | 'points' | 'goal', HTMLElement | null>>({ streak: null, run: null, points: null, goal: null });
  const setAnchor = useMemo(() => ({
    streak: (el: HTMLElement | null) => { anchors.current.streak = el; },
    run: (el: HTMLElement | null) => { anchors.current.run = el; },
    points: (el: HTMLElement | null) => { anchors.current.points = el; },
    goal: (el: HTMLElement | null) => { anchors.current.goal = el; },
  }), []);
  const [pulse, setPulse] = useState({ run: 0, streak: 0, best: 0, won: 0 });
  const [fresh, setFresh] = useState<ReadonlySet<BadgeId>>(new Set());
  const [primed, setPrimed] = useState(false);
  const prevSnap = useRef<GameSnapshot | null>(null);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restingMood: BlobState = touchesToday > 0 ? 'idle' : streak.current === 0 && streak.lastTouch ? 'drowsy' : 'idle';
  useEffect(() => { if (!moodTimer.current) onMood?.(restingMood); }, [restingMood, onMood]);
  const cheer = useCallback((ms: number) => {
    onMood?.('joy');
    if (moodTimer.current) clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => { moodTimer.current = null; onMood?.(restingMood); }, ms);
  }, [onMood, restingMood]);
  useEffect(() => () => { if (moodTimer.current) clearTimeout(moodTimer.current); }, []);

  const unlocked = badgeList.filter(b => b.unlocked).map(b => b.id);
  const weekTouches = weeks.at(-1)?.count ?? 0;
  const snapKey = JSON.stringify([done.map(d => d.key).sort(), touchesToday, streak.current, weekPoints, weekTouches, bestBefore, unlocked, counts.won]);
  useEffect(() => {
    if (loading) return;
    const snapshot: GameSnapshot = {
      done: new Set(done.map(d => d.key)), touchesToday, streak: streak.current, weekPoints, weekTouches,
      bestBefore, unlocked: new Set(unlocked), wonThisMonth: counts.won,
    };
    // The first load (and anything still arriving just after it) sets the baseline quietly.
    const events = primed ? gameEvents(prevSnap.current, snapshot) : [];
    prevSnap.current = snapshot;
    for (const e of events) {
      if (e.type === 'streak') {
        setPulse(p => ({ ...p, streak: p.streak + 1 }));
        fire('embers', anchors.current.streak);
        addToast(`Streak: ${e.days} ${e.days === 1 ? 'day' : 'days'}`);
        cheer(2200);
      } else if (e.type === 'run') {
        setPulse(p => ({ ...p, run: p.run + 1 }));
        fire('confetti');
        addToast(`Today's run done: ${RUN_SIZE} touches`);
        cheer(4500);
      } else if (e.type === 'best-week') {
        setPulse(p => ({ ...p, best: p.best + 1 }));
        fire('gold', anchors.current.points);
        addToast(`New best week: ${e.count} touches`);
        cheer(3000);
      } else if (e.type === 'badge') {
        setFresh(new Set(e.ids));
        for (const id of e.ids) fire('gold', document.querySelector(`[data-badge="${id}"]`));
        const names = e.ids.map(id => badgeList.find(b => b.id === id)?.name).filter(Boolean).join(', ');
        addToast(`Badge unlocked: ${names}`);
        cheer(3000);
      } else if (e.type === 'won') {
        setPulse(p => ({ ...p, won: p.won + 1 }));
        fire('coins', anchors.current.goal ?? document.querySelector('[data-testid="game-board"]'));
        addToast(`Deal won · +${POINTS.won} pts`);
        cheer(4000);
      }
    }
    // snapKey stands for the snapshot's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, snapKey, primed]);
  useEffect(() => {
    if (loading || primed) return;
    const timer = setTimeout(() => setPrimed(true), reduced() ? 0 : 800);
    return () => clearTimeout(timer);
  }, [loading, primed]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-xl border border-clay-hairline bg-white p-5 text-sm text-clay-muted dark:bg-clay-card">
        Loading this week…
      </div>
    );
  }

  const waitingLeads = leads?.waiting ?? [];
  const footnote: ReactNode = waitingLeads.length > 0 || sweepCount > 0 ? (
    <>
      {sweepCount > 0 && (
        <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-clay-muted" data-testid="sweep-entry">
          <Inbox className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{sweepCount} {sweepCount === 1 ? 'lead has' : 'leads have'} never been contacted.</span>
          <button type="button" onClick={() => setSweepOpen(true)} className={clsx('shrink-0 rounded font-semibold text-clay-lavender hover:underline', focusRing)}>Sort the pile</button>
        </p>
      )}
      {waitingLeads.length > 0 && (
        <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-clay-muted">
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {waitingLeads.length} {waitingLeads.length === 1 ? 'lead is' : 'leads are'} waiting for a way in ({waitingLeads.slice(0, 2).map(w => w.company.name).join(', ')}{waitingLeads.length > 2 ? '…' : ''}). Owner search runs Tue and Thu.
        </p>
      )}
    </>
  ) : null;

  const decisions: ReactNode = needsReview.length > 0 ? (
    <div className="mb-3 rounded-xl border border-clay-hairline bg-clay-surface p-2.5 dark:bg-clay-hairline/30" data-testid="decisions">
      <h3 className="px-1 text-xs font-semibold text-clay-ink">Needs a decision · {needsReview.length}</h3>
      <ul>
        {needsReview.map(item => {
          const name = item.companyName || item.dealTitle || 'Deal';
          const href = item.dealId ? `/deals?deal=${encodeURIComponent(item.dealId)}` : item.companyId ? `/companies?company=${encodeURIComponent(item.companyId)}` : null;
          return (
            <li key={item.id} className="flex items-center gap-2 border-t border-clay-hairline px-1 py-2 first:border-t-0">
              <Building2 className="h-4 w-4 shrink-0 text-clay-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[13px] text-clay-ink">
                <b className="font-semibold">{name}</b>
                <span className="block text-xs text-clay-muted">{item.holds.length > 0 ? <span className="font-semibold text-clay-error">On hold — check before contacting</span> : item.reason}</span>
              </span>
              {href && <Link href={href} aria-label={`Open ${item.dealTitle || name}`} className={clsx('inline-flex h-8 shrink-0 items-center rounded-lg border border-clay-hairline px-2.5 text-xs font-medium text-clay-ink hover:border-clay-lavender', focusRing)}>Open</Link>}
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  return (
    <div data-testid="this-week-queue" className="mb-6 min-w-0 space-y-4">
      {sourceError && (
        <div role="alert" className="rounded-lg border border-clay-error/40 bg-clay-error/5 px-3 py-3 text-sm text-clay-ink">
          <p>CRM data could not be loaded. This list may be incomplete.</p>
          <button
            type="button"
            onClick={onRetry}
            className={clsx('mt-2 min-h-11 rounded-md border border-clay-hairline px-3 py-2 text-xs font-semibold hover:border-clay-lavender', focusRing)}
          >
            Retry loading
          </button>
        </div>
      )}

      {accountEventsUnavailable && (
        <p role="status" className="rounded-lg border border-clay-ochre/40 bg-clay-ochre/5 px-3 py-2 text-xs text-clay-ink">
          Sales history didn’t load, so customer check-ins may be incomplete.
        </p>
      )}

      <GameBar
        touchesToday={touchesToday}
        streak={streak}
        weeks={weeks}
        bestBefore={bestBefore}
        weekPoints={weekPoints}
        goal={goal}
        goalFailed={goals === 'error'}
        lastMonth={lastMonth}
        onGoalSaved={amount => setGoals(g => (g && g !== 'error' ? { ...g, cur: amount } : { cur: amount, last: null }))}
        onRunClick={() => document.getElementById('follow-ups')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
        pulse={pulse}
        anchors={setAnchor}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-start">
        <QuestList
          run={run}
          next={next}
          done={done}
          touchesToday={touchesToday}
          primed={primed}
          runPulse={pulse.run}
          footnote={footnote}
          decisions={decisions}
          quiet={sourceError}
        />
        <div className="min-w-0 space-y-4">
          <GameBoard counts={counts} tokens={tokens} />
          <BadgeGrid badges={badgeList} fresh={fresh} />
          <PointsRules />
          <RecentChanges folded />
        </div>
      </div>
      <ReachOutSweep open={sweepOpen} onClose={() => setSweepOpen(false)} />
      {quickLog.last && (
        <LoggedNote
          entry={quickLog.last}
          today={today}
          onFollowup={days => { void quickLog.setFollowup(days); }}
          onUndo={() => { void quickLog.undo(); }}
          onClose={quickLog.close}
        />
      )}
    </div>
  );
}
