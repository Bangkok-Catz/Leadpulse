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
import { Building2, HeartHandshake, Landmark, Mail, MessageCircle, Package, Phone, Search, Users, type LucideIcon } from 'lucide-react';
import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import * as crm from '@/lib/crm';
import RecentChanges from '@/components/RecentChanges';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import { useCelebrate } from '@/components/game/Celebrate';
import GameBar, { type MonthGoal } from '@/components/game/GameBar';
import QuestList, { type QuestView } from '@/components/game/QuestList';
import { BadgeGrid, GameBoard, PointsRules, type BoardToken } from '@/components/game/GameBoard';
import { LeadTools, ROUTE_ICON, leadAction, leadChannel, useLeadActions } from '@/components/LeadActions';
import type { BlobState } from '@/components/blob';
import { useLayaGrades } from '@/hooks/useLayaReviewList';
import type { HealthTier } from '@/utils/accountHealth';
import { actionChannel, type ActionChannel } from '@/utils/action-channel';
import { businessDaysBetween } from '@/utils/business-time';
import { formatScheduleDate } from '@/utils/deal-schedule';
import { WORKFLOW_BY_ID, addDaysToDateKey, getWorkflowAction } from '@/utils/deal-workflow';
import { buildDoNext, type DoNextKind } from '@/utils/do-next';
import type { AttentionCandidate } from '@/utils/followup-policy';
import { formatBaht } from '@/utils/format';
import {
  POINTS, RUN_SIZE, badges as readBadges, bestWeek, boardCounts, doneToday, gameEvents, isQuestDone, laneWins,
  pickRun, pointsBetween, pointsContext, questPoints, questWeight, shortAction, stopOf, streak as readStreak, touchesByDay,
  weekStart, weeklyTouches, type BadgeId, type GameSnapshot,
} from '@/utils/game';
import { goalProgress, monthStart } from '@/utils/goal-progress';
import type { GrowthDue } from '@/utils/growth';
import { laneTimelines } from '@/utils/lane-time';
import { TOUCH_LIMIT, type TodaysLeads } from '@/utils/prospecting';
import type { ThisWeekQueue as Queue } from '@/utils/this-week-queue';
import { daysOverdue } from '@/utils/this-week-stats';

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
  /** today's leads (utils/prospecting.ts) */
  leads?: TodaysLeads;
  /** funding steps that are late or due this week (Growth page) */
  growth?: GrowthDue;
  /** the mascot's mood: sleepy when the streak is cold, joyful on a win */
  onMood?: (state: BlobState) => void;
}

/** Reasons that mean someone is waiting on Pat. Stalled and missing-data reasons live on Pipeline. */
const WAITING_KINDS: readonly DoNextKind[] = ['asked', 'review', 'waiting'];
const WAITING_TAG: Partial<Record<DoNextKind, string>> = { asked: 'Buyer asked', review: 'Needs a look', waiting: 'Buyer replied' };

const CHANNEL: Record<ActionChannel, { icon: LucideIcon; label: string }> = {
  call: { icon: Phone, label: 'Call' },
  email: { icon: Mail, label: 'Email' },
  message: { icon: MessageCircle, label: 'Message' },
  meeting: { icon: Users, label: 'Visit' },
};

const SAMPLE = /sample|ตัวอย่าง/i;

const CHECK_IN: Record<HealthTier | 'reorder_only', { tag: string; action: string }> = {
  at_risk: { tag: 'At risk', action: 'Check in before they go quiet' },
  dormant: { tag: 'Dormant', action: 'Win them back' },
  watch: { tag: 'Watch', action: 'Check in' },
  healthy: { tag: 'Regular', action: 'Check in' },
  reorder_only: { tag: 'Reorder due', action: 'Ask about a reorder' },
};

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender';

function shortDate(dateKey: string): string {
  return formatScheduleDate(dateKey).replace(/ \d{4}$/, '');
}

function dueTag(dateKey: string, today: string): string {
  const offset = businessDaysBetween(today, dateKey);
  if (offset === 0) return 'Due today';
  if (offset === 1) return 'Due tomorrow';
  return `Due ${shortDate(dateKey)}`;
}

function channelFor(action: string | null | undefined): QuestView['channel'] {
  if (action && SAMPLE.test(action)) return { icon: Package, label: 'Sample' };
  const c = actionChannel(action);
  return c ? CHANNEL[c] : null;
}

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
  leads,
  growth,
  onMood,
}: ThisWeekQueueProps) {
  const { needsReview, overdue, dueThisWeek, checkIns, needsDate } = queue;
  const { activities = [] } = useCrm();
  const { addToast } = useToast();
  const { fire } = useCelebrate();
  const leadActions = useLeadActions(today);

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

  /* ── Every step, as one list ── */
  const { log: logLead, park: parkLead, busy: leadBusy } = leadActions;
  const quests = useMemo(() => {
    const byKey = new Map<string, QuestView>();
    const add = (q: Omit<QuestView, 'weight'>) => {
      const existing = byKey.get(q.key);
      if (existing) {
        if (q.late > existing.late) byKey.set(q.key, { ...existing, late: q.late, weight: questWeight({ ...existing, late: q.late }) });
        return;
      }
      byKey.set(q.key, { ...q, weight: questWeight(q) });
    };
    const lateOf = new Map(overdue.filter(c => c.dealId).map(c => [c.dealId!, daysOverdue(c.dueDate, today)]));
    const logoOf = (companyId: string | null | undefined) => (companyId ? companiesById.get(companyId)?.logo_url : null);
    const regular = (companyId: string | null | undefined) => Boolean(companyId && ctx.regulars.has(companyId));

    for (const item of waitingOnYou) {
      const { deal } = item;
      const name = (deal.company_id ? companiesById.get(deal.company_id)?.name : null) || deal.client || deal.title || 'Deal';
      const full = deal.next_action?.trim() || '';
      const action = shortAction(full) || 'Reply to the buyer';
      const lane = WORKFLOW_BY_ID[getWorkflowAction(deal)]?.shortLabel;
      const href = `/deals?deal=${encodeURIComponent(deal.id)}`;
      add({
        key: `deal:${deal.id}`, kind: 'reply', name, action, dealId: deal.id, companyId: deal.company_id,
        late: lateOf.get(deal.id) ?? 0, points: questPoints('reply', full || action, regular(deal.company_id), false), bonus: 0,
        held: heldDealIds.has(deal.id), logoUrl: logoOf(deal.company_id), channel: channelFor(full || action) ?? CHANNEL.message,
        tag: WAITING_TAG[item.reasons[0].kind] ?? null,
        detail: <DetailLines lines={[full !== action ? full : null, item.reasons[0].label, lane && `Stage: ${lane}`, deal.value ? `Worth ${formatBaht(deal.value)}` : null]} link={{ href, label: 'Open deal' }} />,
        href,
        onDone: () => onLogDeal(deal.id), doneLabel: `Done: log interaction for ${deal.title || name}`,
      });
    }

    const followup = (item: AttentionCandidate, kind: 'late' | 'due' | 'undated') => {
      const deal = item.dealId ? dealsById.get(item.dealId) : undefined;
      const name = item.companyName || item.dealTitle || 'Deal';
      const title = item.dealTitle || name;
      const full = item.nextAction?.trim() || '';
      const action = shortAction(full) || (kind === 'undated' ? 'Set a follow-up date' : 'Follow up');
      const lane = deal ? WORKFLOW_BY_ID[getWorkflowAction(deal)]?.shortLabel : null;
      const canLog = kind !== 'undated' && Boolean(item.dealId) && item.action === 'honor_saved_followup' && item.holds.length === 0;
      const href = item.dealId ? `/deals?deal=${encodeURIComponent(item.dealId)}` : item.companyId ? `/companies?company=${encodeURIComponent(item.companyId)}` : null;
      add({
        key: item.dealId ? `deal:${item.dealId}` : `company:${item.companyId ?? item.id}`,
        kind, name, action, dealId: item.dealId, companyId: item.companyId,
        late: kind === 'late' ? daysOverdue(item.dueDate, today) : 0,
        points: questPoints(kind, full || action, regular(item.companyId), false), bonus: 0,
        held: item.holds.length > 0, logoUrl: logoOf(item.companyId), channel: channelFor(full || action),
        tag: kind === 'due' && item.dueDate ? dueTag(item.dueDate, today) : kind === 'undated' ? 'No date' : item.priority === 'high' ? 'High priority' : null,
        detail: <DetailLines
          lines={[
            full !== action ? full : null,
            kind === 'undated' ? 'Open the deal to set a follow-up date or park it.' : null,
            lane && `Stage: ${lane}`,
            deal?.value ? `Worth ${formatBaht(deal.value)}` : null,
            deal?.last_outcome ? `Last time: ${deal.last_outcome}` : null,
          ]}
          link={href ? { href, label: item.dealId ? 'Open deal' : 'Open account' } : undefined}
        />,
        href,
        onDone: canLog ? () => onLogDeal(item.dealId!) : undefined,
        doneLabel: canLog ? `Done: log interaction for ${title}` : `Open: ${title}`,
      });
    };
    overdue.forEach(item => followup(item, 'late'));
    dueThisWeek.forEach(item => followup(item, 'due'));
    needsDate.forEach(item => followup(item, 'undated'));

    for (const lead of [...(leads?.today ?? []), ...(leads?.more ?? [])]) {
      const action = leadAction(lead);
      const finished = lead.next > TOUCH_LIMIT;
      // The bonus is only promised when the route's contact is an owner or decision maker.
      const owner = Boolean(lead.route.contact && ctx.deciders.has(lead.route.contact.id));
      add({
        key: `deal:${lead.deal.id}`, kind: 'lead', name: lead.company.name, action, dealId: lead.deal.id, companyId: lead.company.id,
        late: lead.stage === 'attempting' && lead.due < today ? daysOverdue(lead.due, today) : 0,
        points: finished ? 0 : questPoints('lead', action, false, owner), bonus: owner ? 0 : POINTS.owner, held: false,
        logoUrl: lead.company.logo_url, channel: { icon: ROUTE_ICON[lead.route.type], label: leadChannel(lead) },
        tag: lead.stage === 'new' ? 'New lead' : null,
        detail: (
          <>
            {lead.fit != null && <p className="mb-1">Fit {Math.round(lead.fit * 100)}%</p>}
            {!owner && !finished && <p className="mb-1.5 font-medium text-clay-ink">+{POINTS.owner} more if you reach the owner</p>}
            <LeadTools lead={lead} today={today} contacts={contacts} busy={leadBusy === lead.deal.id} onLog={logLead} onPark={parkLead} />
          </>
        ),
        href: `/companies?company=${encodeURIComponent(lead.company.id)}`,
        onDone: finished ? undefined : () => { void logLead(lead, lead.route.type); },
        busy: leadBusy === lead.deal.id,
        doneLabel: finished ? `Open: ${lead.company.name}` : `Done: log the touch for ${lead.company.name}`,
      });
    }

    for (const row of checkIns) {
      const tier = CHECK_IN[row.tier ?? 'reorder_only'];
      const late = row.dueDate ? daysOverdue(row.dueDate, today) : 0;
      const href = `/companies?company=${encodeURIComponent(row.companyId)}`;
      add({
        key: `company:${row.companyId}`, kind: 'checkin', name: row.companyName, action: tier.action, dealId: null, companyId: row.companyId,
        late, points: questPoints('checkin', tier.action, true, false), bonus: 0, held: false,
        logoUrl: logoOf(row.companyId), channel: { icon: HeartHandshake, label: 'Regular' },
        tag: row.reorder && !row.dueDate ? `${row.reorder.severityDays}d past reorder` : tier.tag,
        detail: <DetailLines lines={[row.reorder?.evidence, row.dueDate && late === 0 ? `Check-in due ${shortDate(row.dueDate)}` : null]} link={{ href, label: 'Open account' }} />,
        href,
        onDone: () => onLogCompany(row.companyId), doneLabel: `Done: log interaction for ${row.companyName}`,
      });
    }

    const fundingRows = [...(growth?.overdue ?? []).map(g => ({ g, late: true })), ...(growth?.week ?? []).map(g => ({ g, late: false }))];
    for (const { g, late } of fundingRows) {
      add({
        key: `growth:${g.id}`, kind: 'funding', name: g.name, action: g.next_step?.trim() || 'Next step', dealId: null, companyId: null,
        late: late && g.next_date ? daysOverdue(g.next_date, today) : 0, points: 0, bonus: 0, held: false,
        channel: { icon: Landmark, label: 'Funding' }, tag: !late && g.next_date ? dueTag(g.next_date, today) : null,
        detail: null, href: '/growth', doneLabel: `Open ${g.name} on Growth`,
      });
    }
    return [...byKey.values()];
  }, [waitingOnYou, overdue, dueThisWeek, needsDate, leads, checkIns, growth, today, dealsById, companiesById, ctx, heldDealIds, contacts, logLead, parkLead, leadBusy, onLogDeal, onLogCompany]);

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
  const footnote: ReactNode = waitingLeads.length > 0 ? (
    <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-clay-muted">
      <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {waitingLeads.length} {waitingLeads.length === 1 ? 'lead is' : 'leads are'} waiting for a way in ({waitingLeads.slice(0, 2).map(w => w.company.name).join(', ')}{waitingLeads.length > 2 ? '…' : ''}). Owner search runs Tue and Thu.
    </p>
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
    </div>
  );
}
