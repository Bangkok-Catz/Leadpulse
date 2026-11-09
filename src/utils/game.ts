// ─── This week as a game: today's run, the streak, points, the board and badges ───
// Pure. Everything is read from what is already logged (touches, lane moves, won deals),
// so nothing new is stored and the game can never disagree with the CRM. Dates are
// Bangkok date keys ('YYYY-MM-DD').
//
// A touch is a call, email, DM, visit, nudge or sample sent to a buyer, or a buyer's reply.
// Notes, rewards and internal entries are not touches and score nothing, so the game can't
// be won with busywork.

import type { Company, Contact, Deal, Meeting } from '../types/crm';
import { addDaysToDateKey, getWorkflowAction, isOnJourneyBoard } from './deal-workflow';
import { businessDateKey } from './business-time';
import { goalProgress } from './goal-progress';
import type { LaneTimeline } from './lane-time';
import { DECIDER } from './prospecting';

/** Touches that finish a day's run. */
export const RUN_SIZE = 5;

export const POINTS = {
  /** a first message, a follow-up or a nudge */
  touch: 10,
  /** extra when the touch reached an owner or decision maker */
  owner: 25,
  /** a touch with a customer who has bought before */
  regular: 30,
  /** the buyer wrote back */
  reply: 30,
  sample: 40,
  /** a deal moved into Testing */
  testing: 60,
  /** a deal marked won */
  won: 150,
} as const;

type TouchFields = Pick<Meeting, 'date' | 'type' | 'direction'>;
type ScoredMeeting = Pick<Meeting, 'id' | 'date' | 'type' | 'direction' | 'deal_id' | 'company_id' | 'contact_ids'>;

export function isTouch(m: TouchFields): boolean {
  if (!m.date) return false;
  if (m.type === 'note' || m.type === 'reward') return false;
  return m.direction !== 'internal';
}

const dayOf = (m: Pick<Meeting, 'date'>) => m.date.slice(0, 10);

/* ── Calendar ─────────────────────────────────────────────────────────────── */

function utc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isWeekend(key: string): boolean {
  const w = utc(key).getUTCDay();
  return w === 0 || w === 6;
}

/** The Monday of the week a date falls in. */
export function weekStart(key: string): string {
  return addDaysToDateKey(key, -((utc(key).getUTCDay() + 6) % 7));
}

const fmt = (key: string, opts: Intl.DateTimeFormatOptions) => utc(key).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

/** "7 Sep" */
export const dayMonth = (key: string) => fmt(key, { day: 'numeric', month: 'short' });
/** "Thu 29 Oct" */
export const weekdayDayMonth = (key: string) => fmt(key, { weekday: 'short', day: 'numeric', month: 'short' });
/** "October" */
export const monthName = (key: string) => fmt(key, { month: 'long' });

/** "19–24 Oct", or "30 Sep – 2 Oct" across months. */
export function dayRange(from: string, to: string): string {
  if (from === to) return dayMonth(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${dayMonth(to)}`;
  return `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** "7 Sep and 19 Oct", "7 Sep, 14 Sep and 19 Oct" */
function joinDays(keys: string[]): string {
  const days = keys.map(dayMonth);
  return days.length <= 1 ? (days[0] ?? '') : `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`;
}

/* ── Points ───────────────────────────────────────────────────────────────── */

export interface PointsContext {
  /** companies that have bought: active customers and companies with a won deal */
  regulars: ReadonlySet<string>;
  /** contacts who decide: a deal's or company's decision maker, or an owner/manager title */
  deciders: ReadonlySet<string>;
  /** a deal's company, for touches logged against the deal only */
  dealCompany: ReadonlyMap<string, string | null>;
}

export function pointsContext(input: {
  deals: readonly Pick<Deal, 'id' | 'company_id' | 'stage' | 'decision_maker_contact_id'>[];
  companies: readonly Pick<Company, 'id' | 'status' | 'decision_maker_contact_id'>[];
  contacts: readonly Pick<Contact, 'id' | 'job_title'>[];
}): PointsContext {
  const regulars = new Set<string>();
  const deciders = new Set<string>();
  const dealCompany = new Map<string, string | null>();
  for (const c of input.companies) {
    if (c.status === 'active_customer') regulars.add(c.id);
    if (c.decision_maker_contact_id) deciders.add(c.decision_maker_contact_id);
  }
  for (const d of input.deals) {
    dealCompany.set(d.id, d.company_id);
    if (d.stage === 'closed_won' && d.company_id) regulars.add(d.company_id);
    if (d.decision_maker_contact_id) deciders.add(d.decision_maker_contact_id);
  }
  for (const c of input.contacts) if (DECIDER.test(c.job_title ?? '')) deciders.add(c.id);
  return { regulars, deciders, dealCompany };
}

const companyOf = (m: Pick<Meeting, 'company_id' | 'deal_id'>, ctx: PointsContext) =>
  m.company_id ?? (m.deal_id ? ctx.dealCompany.get(m.deal_id) ?? null : null);

export const reachedDecider = (m: Pick<Meeting, 'contact_ids'>, ctx: PointsContext) =>
  (m.contact_ids ?? []).some(id => ctx.deciders.has(id));

/** What one logged entry scores. */
export function meetingPoints(m: ScoredMeeting, ctx: PointsContext): number {
  if (!isTouch(m)) return 0;
  if (m.direction === 'inbound') return POINTS.reply;
  const company = companyOf(m, ctx);
  const base = m.type === 'sample_sent' ? POINTS.sample : company && ctx.regulars.has(company) ? POINTS.regular : POINTS.touch;
  return base + (reachedDecider(m, ctx) ? POINTS.owner : 0);
}

export interface LaneWin {
  dealId: string;
  kind: 'testing' | 'won';
  date: string;
  points: number;
}

/** Deals that moved into Testing, and deals won, each on the day it happened. */
export function laneWins(deals: readonly Deal[], timelines: ReadonlyMap<string, LaneTimeline>): LaneWin[] {
  const wins: LaneWin[] = [];
  for (const deal of deals) {
    const timeline = timelines.get(deal.id);
    for (const stay of timeline?.stays ?? []) {
      if (stay.lane === 'testing' && stay.from !== null && timeline?.source === 'moved') {
        wins.push({ dealId: deal.id, kind: 'testing', date: businessDateKey(new Date(stay.from)), points: POINTS.testing });
      }
    }
    if (deal.stage !== 'closed_won') continue;
    const closed = deal.close_date && /^\d{4}-\d{2}-\d{2}/.test(deal.close_date)
      ? deal.close_date.slice(0, 10)
      : timeline?.source === 'moved' ? businessDateKey(new Date(timeline.enteredAt)) : null;
    if (closed) wins.push({ dealId: deal.id, kind: 'won', date: closed, points: POINTS.won });
  }
  return wins;
}

/** Points from touches and lane wins dated from `from` to `to`, both included. */
export function pointsBetween(meetings: readonly ScoredMeeting[], wins: readonly LaneWin[], ctx: PointsContext, from: string, to: string): number {
  let total = 0;
  for (const m of meetings) {
    if (!m.date) continue;
    const day = dayOf(m);
    if (day >= from && day <= to) total += meetingPoints(m, ctx);
  }
  for (const w of wins) if (w.date >= from && w.date <= to) total += w.points;
  return total;
}

/* ── Days, weeks and the streak ───────────────────────────────────────────── */

/** Touches per day. */
export function touchesByDay(meetings: readonly TouchFields[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const m of meetings) {
    if (!isTouch(m)) continue;
    const day = dayOf(m);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}

export interface Streak {
  /** days in a row with a touch, counting today once it has one */
  current: number;
  /** today already has a touch */
  litToday: boolean;
  best: number;
  bestFrom: string | null;
  bestTo: string | null;
  lastTouch: string | null;
}

/**
 * Days in a row with at least one touch. Saturday and Sunday never break it (a touch on
 * one still adds a day), and today only counts once it has a touch, so the streak is
 * still alive in the morning.
 */
export function streak(days: ReadonlyMap<string, number>, today: string): Streak {
  const keys = [...days.keys()].filter(k => k <= today).sort();
  const litToday = (days.get(today) ?? 0) > 0;

  let current = litToday ? 1 : 0;
  for (let d = addDaysToDateKey(today, -1), guard = 0; guard < 4000; d = addDaysToDateKey(d, -1), guard++) {
    if ((days.get(d) ?? 0) > 0) current++;
    else if (!isWeekend(d)) break;
    if (d < (keys[0] ?? today)) break;
  }

  let best = 0;
  let bestFrom: string | null = null;
  let bestTo: string | null = null;
  let run = 0;
  let from: string | null = null;
  if (keys.length > 0) {
    for (let d = keys[0]; d <= today; d = addDaysToDateKey(d, 1)) {
      if ((days.get(d) ?? 0) > 0) {
        if (run === 0) from = d;
        run++;
        if (run > best) { best = run; bestFrom = from; bestTo = d; }
      } else if (!isWeekend(d) && d !== today) {
        run = 0;
      }
    }
  }
  return { current, litToday, best, bestFrom, bestTo, lastTouch: keys.at(-1) ?? null };
}

export interface WeekCount {
  /** the Monday */
  start: string;
  count: number;
}

/** Touches per week, Monday to Sunday, oldest first, this week last. */
export function weeklyTouches(days: ReadonlyMap<string, number>, today: string, weeks = 11): WeekCount[] {
  const thisWeek = weekStart(today);
  const out: WeekCount[] = Array.from({ length: weeks }, (_, i) => ({ start: addDaysToDateKey(thisWeek, (i - weeks + 1) * 7), count: 0 }));
  const index = new Map(out.map((w, i) => [w.start, i]));
  for (const [day, n] of days) {
    const i = index.get(weekStart(day));
    if (i !== undefined) out[i].count += n;
  }
  return out;
}

/** The most touches in any one week so far, and which weeks reached it. */
export function bestWeek(days: ReadonlyMap<string, number>): { count: number; starts: string[] } {
  const byWeek = new Map<string, number>();
  for (const [day, n] of days) byWeek.set(weekStart(day), (byWeek.get(weekStart(day)) ?? 0) + n);
  const count = Math.max(0, ...byWeek.values());
  return { count, starts: count === 0 ? [] : [...byWeek].filter(([, n]) => n === count).map(([w]) => w).sort() };
}

/* ── Badges ───────────────────────────────────────────────────────────────── */

export type BadgeId = 'ten' | 'six' | 'three' | 'samples' | 'clean' | 'owner';

export interface Badge {
  id: BadgeId;
  name: string;
  desc: string;
  unlocked: boolean;
  /** when it was earned, in words */
  got: string | null;
}

export function badges(input: {
  days: ReadonlyMap<string, number>;
  meetings: readonly ScoredMeeting[];
  deals: readonly Deal[];
  timelines: ReadonlyMap<string, LaneTimeline>;
  ctx: PointsContext;
  /** late follow-ups right now */
  late: number;
  today: string;
}): Badge[] {
  const { days, meetings, ctx, today } = input;
  const thisWeek = weekStart(today);

  const byWeek = new Map<string, number>();
  for (const [day, n] of days) byWeek.set(weekStart(day), (byWeek.get(weekStart(day)) ?? 0) + n);
  const tenWeeks = [...byWeek].filter(([, n]) => n >= 10).map(([w]) => w).sort();

  const s = streak(days, today);

  const wonByMonth = new Map<string, number>();
  for (const w of laneWins(input.deals, input.timelines)) {
    if (w.kind === 'won') wonByMonth.set(w.date.slice(0, 7), (wonByMonth.get(w.date.slice(0, 7)) ?? 0) + 1);
  }
  const threeMonths = [...wonByMonth].filter(([, n]) => n >= 3).map(([m]) => m).sort();

  const samplesByWeek = new Map<string, number>();
  for (const m of meetings) {
    if (m.type !== 'sample_sent' || !isTouch(m) || m.direction === 'inbound') continue;
    samplesByWeek.set(weekStart(dayOf(m)), (samplesByWeek.get(weekStart(dayOf(m))) ?? 0) + 1);
  }
  const sampleWeeks = [...samplesByWeek].filter(([, n]) => n >= 2).map(([w]) => w).sort();

  const ownerDays = meetings.filter(m => isTouch(m) && reachedDecider(m, ctx)).map(dayOf).sort();
  const hasOpenWork = input.deals.some(isOnJourneyBoard);

  const weekWord = (w: string) => (w === thisWeek ? 'This week' : `Week of ${dayMonth(w)}`);
  return [
    { id: 'ten', name: 'Ten in a week', desc: '10 touches in one week', unlocked: tenWeeks.length > 0, got: tenWeeks.length ? joinDays(tenWeeks.slice(-2)) : null },
    { id: 'six', name: 'Six in a row', desc: 'Touches 6 days running', unlocked: s.best >= 6, got: s.best >= 6 && s.bestFrom && s.bestTo ? dayRange(s.bestFrom, s.bestTo) : null },
    { id: 'three', name: 'Three wins', desc: '3 deals won in one month', unlocked: threeMonths.length > 0, got: threeMonths.length ? monthName(`${threeMonths.at(-1)}-01`) : null },
    { id: 'samples', name: 'Samples out', desc: '2 samples sent in one week', unlocked: sampleWeeks.length > 0, got: sampleWeeks.length ? weekWord(sampleWeeks.at(-1)!) : null },
    { id: 'clean', name: 'Clean slate', desc: 'No late follow-ups', unlocked: hasOpenWork && input.late === 0, got: hasOpenWork && input.late === 0 ? 'Now' : null },
    { id: 'owner', name: 'Owner reached', desc: 'A touch with an owner or decision maker', unlocked: ownerDays.length > 0, got: ownerDays.length ? weekdayDayMonth(ownerDays.at(-1)!) : null },
  ];
}

/* ── Today's run ──────────────────────────────────────────────────────────── */

export type QuestKind = 'reply' | 'late' | 'due' | 'undated' | 'checkin' | 'lead' | 'funding';

export interface Quest {
  /** 'deal:<id>', 'company:<id>' or 'growth:<id>' */
  key: string;
  kind: QuestKind;
  name: string;
  /** what to do, in a few words */
  action: string;
  dealId: string | null;
  companyId: string | null;
  /** days past its date; 0 when not late */
  late: number;
  /** what finishing it is likely to score */
  points: number;
  /** extra points if it goes better than planned, e.g. reaching the owner */
  bonus: number;
  /** a known contact hold: check before contacting */
  held: boolean;
  /** higher goes first */
  weight: number;
}

/**
 * A saved next step cut down to one short line: "Pat: send samples for testing on
 * 2026-10-20 (planned; not dispatched). Confirm…" becomes "Send samples for testing".
 * The full text stays in the row's Details.
 */
export function shortAction(text: string | null | undefined, max = 60): string {
  let s = (text ?? '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(pat|me|i)\s*[:\-–—]\s*/i, '');
  s = s.replace(/^(pat|i)\s+(plans? to|will|wants? to|needs? to|should|to)\s+/i, '');
  s = s.replace(/\s*\([^)]*\)/g, '');
  s = s.split(/(?<=[.!?])\s|;\s|\s[–—]\s|:\s|\n/)[0] ?? s;
  s = s.replace(/\s*\(.*$/, '');
  s = s.replace(/\s+(on|by|before|from|until)\s+\d{4}-\d{2}-\d{2}\b/gi, '').replace(/\s*\d{4}-\d{2}-\d{2}\b/g, '');
  s = s.replace(/[\s,.;:]+$/, '').trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    s = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,.;:]+$/, '')}…`;
  }
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

const SEND_SAMPLE = /\bsend\b[^.]*\bsamples?\b|\bsamples?\b[^.]*\bsend\b|ส่ง\s*ตัวอย่าง/i;

/** What a step is likely to score before it's done. */
export function questPoints(kind: QuestKind, action: string, regular: boolean, owner: boolean): number {
  if (kind === 'funding') return 0;
  if (SEND_SAMPLE.test(action)) return POINTS.sample + (owner ? POINTS.owner : 0);
  if (kind === 'checkin' || regular) return POINTS.regular + (owner ? POINTS.owner : 0);
  return POINTS.touch + (owner ? POINTS.owner : 0);
}

export function questWeight(q: Pick<Quest, 'kind' | 'points' | 'late' | 'held'>): number {
  if (q.kind === 'funding') return -100;
  return q.points + Math.min(q.late, 20) + (q.kind === 'reply' ? 30 : 0) + (q.kind === 'late' ? 10 : 0) + (q.kind === 'undated' ? -20 : 0) - (q.held ? 200 : 0);
}

/** Most of these per run, so a long list of check-ins or leads never fills it alone. */
const RUN_CAP: Partial<Record<QuestKind, number>> = { checkin: 1, lead: 2 };
/** Never in the run: they need a date or a look, not a touch. */
const NOT_IN_RUN: readonly QuestKind[] = ['undated', 'funding'];

/**
 * The run: up to `slots` steps, biggest first, at most one customer check-in and two
 * leads, with one lead kept in when there is any. The rest is Up next, biggest first.
 */
export function pickRun(quests: readonly Quest[], slots: number): { run: Quest[]; next: Quest[] } {
  const { run, sorted } = pickRunOnce(quests, slots);
  const inRun = new Set(run);
  return { run, next: mixed(sorted.filter(q => !inRun.has(q))) };
}

function pickRunOnce(quests: readonly Quest[], slots: number): { run: Quest[]; sorted: Quest[] } {
  const sorted = [...quests].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  const run: Quest[] = [];
  if (slots > 0) {
    const counts = new Map<QuestKind, number>();
    const fits = (q: Quest) => !q.held && !NOT_IN_RUN.includes(q.kind) && (counts.get(q.kind) ?? 0) < (RUN_CAP[q.kind] ?? Infinity);
    const take = (q: Quest) => { run.push(q); counts.set(q.kind, (counts.get(q.kind) ?? 0) + 1); };
    const firstLead = sorted.find(q => q.kind === 'lead' && fits(q));
    for (const q of sorted) {
      if (run.length >= slots - (firstLead && !run.includes(firstLead) ? 1 : 0)) break;
      if (q !== firstLead && fits(q)) take(q);
    }
    if (firstLead && run.length < slots) take(firstLead);
    for (const q of sorted) {
      if (run.length >= slots) break;
      if (!run.includes(q) && fits(q)) take(q);
    }
    run.sort((a, b) => b.weight - a.weight);
  }
  return { run, sorted };
}

/** Up next in rounds of five picked like the run, so it stays a mix; what can't be in a run goes last. */
function mixed(rest: Quest[]): Quest[] {
  const out: Quest[] = [];
  let left = rest;
  for (let guard = 0; left.length > 0 && guard < 1000; guard++) {
    const { run } = pickRunOnce(left, RUN_SIZE);
    if (run.length === 0) break;
    out.push(...run);
    const taken = new Set(run);
    left = left.filter(q => !taken.has(q));
  }
  return [...out, ...left];
}

/* ── Done today ───────────────────────────────────────────────────────────── */

export interface DoneEntry {
  key: string;
  name: string;
  dealId: string | null;
  companyId: string | null;
  touches: number;
  points: number;
}

/** Today's touches, one entry per deal (or per company for account-level touches). */
export function doneToday(
  meetings: readonly ScoredMeeting[],
  today: string,
  ctx: PointsContext,
  names: { deal: (id: string) => string | null; company: (id: string) => string | null },
): DoneEntry[] {
  const out = new Map<string, DoneEntry>();
  for (const m of meetings) {
    if (!isTouch(m) || dayOf(m) !== today) continue;
    const companyId = companyOf(m, ctx);
    const key = m.deal_id ? `deal:${m.deal_id}` : companyId ? `company:${companyId}` : `meeting:${m.id}`;
    const entry = out.get(key) ?? {
      key,
      name: (m.deal_id ? names.deal(m.deal_id) : null) ?? (companyId ? names.company(companyId) : null) ?? 'Touch',
      dealId: m.deal_id,
      companyId,
      touches: 0,
      points: 0,
    };
    entry.touches += 1;
    entry.points += meetingPoints(m, ctx);
    out.set(key, entry);
  }
  return [...out.values()];
}

/** A step counts as done once today has a touch on its deal (or, for a check-in, its company). */
export function isQuestDone(q: Pick<Quest, 'kind' | 'dealId' | 'companyId'>, done: readonly DoneEntry[]): boolean {
  if (q.kind === 'funding') return false;
  if (q.dealId) return done.some(d => d.dealId === q.dealId);
  return Boolean(q.companyId) && done.some(d => d.companyId === q.companyId);
}

/* ── The board ────────────────────────────────────────────────────────────── */

export type StopId = 'reach' | 'reply' | 'sample' | 'testing' | 'won';

export const STOPS: { id: StopId; label: string; sub: string }[] = [
  { id: 'reach', label: 'Reach out', sub: 'to contact' },
  { id: 'reply', label: 'Reply', sub: 'waiting' },
  { id: 'sample', label: 'Sample', sub: 'to send' },
  { id: 'testing', label: 'Testing', sub: 'trying it' },
  { id: 'won', label: 'Won', sub: 'this month' },
];

/** Where a deal sits on the board; parked and lost deals are off it. */
export function stopOf(deal: Deal): StopId | null {
  if (deal.stage === 'closed_lost') return null;
  switch (getWorkflowAction(deal)) {
    case 'outreach': return 'reach';
    case 'reply': return 'reply';
    case 'sample': return 'sample';
    case 'testing':
    case 'reschedule': return 'testing';
    case 'success': return 'won';
    default: return null;
  }
}

/** Open deals at each stop, and deals won this month. */
export function boardCounts(deals: readonly Deal[], timelines: ReadonlyMap<string, LaneTimeline>, today: string): Record<StopId, number> {
  const counts: Record<StopId, number> = { reach: 0, reply: 0, sample: 0, testing: 0, won: 0 };
  for (const deal of deals) {
    if (!isOnJourneyBoard(deal)) continue;
    const stop = stopOf(deal);
    if (stop && stop !== 'won') counts[stop] += 1;
  }
  counts.won = goalProgress({ deals: [...deals], timelines, today, goal: null }).wonDeals;
  return counts;
}

/* ── What changed: the moments worth celebrating ─────────────────────────── */

export interface GameSnapshot {
  /** keys of today's done entries */
  done: ReadonlySet<string>;
  touchesToday: number;
  streak: number;
  weekPoints: number;
  weekTouches: number;
  /** the best week before this one */
  bestBefore: number;
  unlocked: ReadonlySet<BadgeId>;
  wonThisMonth: number;
}

export type GameEvent =
  | { type: 'done'; keys: string[] }
  | { type: 'run' }
  | { type: 'streak'; days: number }
  | { type: 'badge'; ids: BadgeId[] }
  | { type: 'best-week'; count: number }
  | { type: 'won' };

/** The celebrations between two snapshots, smallest first. Nothing fires on the first load. */
export function gameEvents(prev: GameSnapshot | null, next: GameSnapshot): GameEvent[] {
  if (!prev) return [];
  const events: GameEvent[] = [];
  const keys = [...next.done].filter(k => !prev.done.has(k));
  if (keys.length) events.push({ type: 'done', keys });
  if (next.streak > prev.streak) events.push({ type: 'streak', days: next.streak });
  if (prev.touchesToday < RUN_SIZE && next.touchesToday >= RUN_SIZE) events.push({ type: 'run' });
  if (next.bestBefore > 0 && prev.weekTouches <= next.bestBefore && next.weekTouches > next.bestBefore) {
    events.push({ type: 'best-week', count: next.weekTouches });
  }
  const ids = [...next.unlocked].filter(id => !prev.unlocked.has(id));
  if (ids.length) events.push({ type: 'badge', ids });
  if (next.wonThisMonth > prev.wonThisMonth) events.push({ type: 'won' });
  return events;
}
