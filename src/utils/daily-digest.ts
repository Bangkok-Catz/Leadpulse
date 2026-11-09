// The morning digest: what This week would show, as one short message. And the
// afternoon nudge: what is still open from today, so a due follow-up or an unanswered
// buyer does not slip to tomorrow. Pure text building; loading lives in lib/digest-data.ts and sending in lib/telegram.ts.

import type { InlineButton } from '@/lib/telegram';
import type { AttentionCandidate } from './followup-policy';
import { RUN_SIZE } from './game';
import { runButtons, type GameDigest } from './game-digest';
import { shortDate } from './quests';
import type { ThisWeekQueue } from './this-week-queue';
import { checkInSplit, daysOverdue } from './this-week-stats';

export interface DigestWaiting {
  name: string;
  /** e.g. "Buyer replied 3 days ago, nothing sent since" */
  label: string;
}

/** A deal at the nudge limit with no reply (park-suggestion.ts): offered, never parked. */
export interface DigestParkSuggestion {
  name: string;
  /** e.g. "4 sends, no reply" */
  label: string;
}

/** A funding step from the Growth page, due today or late. */
export interface DigestGrowth {
  name: string;
  step: string | null;
  /** days late; 0 = due today */
  daysLate: number;
}

export interface DailyDigest {
  /** Telegram HTML (b, a) with every value escaped. */
  text: string;
  /** one tap per run step, sent only once the bot's buttons can reach the app */
  buttons?: InlineButton[][];
  /** Nothing is waiting, overdue, due today, up for a check-in or to park: no message is sent. */
  isEmpty: boolean;
  counts: { waiting: number; overdue: number; dueToday: number; checkIns: number; needsReview: number; parkSuggested: number; growth: number };
}

/** How many rows each list shows before "and N more". */
const LIST_LIMIT = 5;

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function headerDate(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const nameOf = (item: AttentionCandidate) => item.companyName || item.dealTitle || 'Deal';

function list(title: string, rows: string[], total: number): string[] {
  if (rows.length === 0) return [];
  const more = total - rows.length;
  return ['', `<b>${title}</b>`, ...rows.map(row => `• ${row}`), ...(more > 0 ? [`…and ${more} more`] : [])];
}

function followupRow(item: AttentionCandidate, lead?: string): string {
  const action = item.nextAction?.trim();
  return [`<b>${escapeHtml(nameOf(item))}</b>`, lead, action && escapeHtml(action)].filter(Boolean).join(' · ');
}

function runLine(seed: GameDigest['run'][number]): string {
  const when = seed.late > 0 ? `${seed.late}d late` : seed.tag;
  return [`<b>${escapeHtml(seed.name)}</b>`, escapeHtml(seed.action), when && escapeHtml(when)].filter(Boolean).join(' · ');
}

const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** The game's lines: last week (Mondays), the streak, then today's run. */
function gameLines(game: GameDigest): string[] {
  const { streak, lastWeek, run, touchesToday } = game;
  return [
    ...(lastWeek
      ? [`Last week: ${lastWeek.touches} ${lastWeek.touches === 1 ? 'touch' : 'touches'} · best week ${lastWeek.best}${lastWeek.bestStart ? ` (${shortDate(lastWeek.bestStart)})` : ''}`]
      : []),
    `Streak: ${dayWord(streak.current)} · best ${streak.best}`,
    ...(run.length > 0 ? ['', `<b>Today's run · ${Math.min(touchesToday, RUN_SIZE)}/${RUN_SIZE}</b>`, ...run.map(seed => `• ${runLine(seed)}`)] : []),
  ];
}

export function buildDailyDigest(input: {
  queue: ThisWeekQueue;
  waiting: readonly DigestWaiting[];
  parkSuggested?: readonly DigestParkSuggestion[];
  /** funding steps due today or late */
  growth?: readonly DigestGrowth[];
  today: string;
  /** Link back to This week; omitted when unknown. */
  appUrl?: string | null;
  /** The streak and today's run. With it the message leads with the run, and the lists
   *  below it shrink to one line of counts with links. */
  game?: GameDigest | null;
}): DailyDigest {
  const { queue, waiting, today, game } = input;
  const parkSuggested = input.parkSuggested ?? [];
  const growth = [...(input.growth ?? [])].sort((a, b) => b.daysLate - a.daysLate);
  // A held contact is a decision, not a chase: it is counted under "need a decision" only.
  const contactable = (item: AttentionCandidate) => item.holds.length === 0;
  const overdue = queue.overdue.filter(contactable).sort((a, b) => daysOverdue(b.dueDate, today) - daysOverdue(a.dueDate, today));
  const dueToday = queue.dueThisWeek.filter(item => contactable(item) && item.dueDate === today);
  const split = checkInSplit(queue.checkIns);

  const counts = {
    waiting: waiting.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    checkIns: queue.checkIns.length,
    needsReview: queue.needsReview.length,
    parkSuggested: parkSuggested.length,
    growth: growth.length,
  };
  const isEmpty = Object.values(counts).every(count => count === 0) && !(game && game.run.length > 0);

  const summary = [
    counts.waiting > 0 && `${counts.waiting} waiting on you`,
    counts.dueToday > 0 && `${counts.dueToday} due today`,
    counts.overdue > 0 && `${counts.overdue} overdue`,
    counts.checkIns > 0 && `${counts.checkIns} ${counts.checkIns === 1 ? 'check-in' : 'check-ins'}`,
    counts.needsReview > 0 && `${counts.needsReview} need a decision`,
    counts.parkSuggested > 0 && `${counts.parkSuggested} could be parked`,
    counts.growth > 0 && `${counts.growth} funding ${counts.growth === 1 ? 'step' : 'steps'}`,
  ].filter(Boolean).join(' · ');

  const checkInDetail = [split.at_risk && `${split.at_risk} at-risk`, split.dormant && `${split.dormant} dormant`, split.watch && `${split.watch} watch`]
    .filter(Boolean).join(' · ');

  if (game) {
    const links = [
      parkSuggested.length > 0 && input.appUrl && `<a href="${escapeHtml(`${input.appUrl}/deals?filter=park-suggested`)}">Review parking on Pipeline</a>`,
      growth.length > 0 && input.appUrl && `<a href="${escapeHtml(`${input.appUrl}/growth`)}">Open Growth</a>`,
      input.appUrl && `<a href="${escapeHtml(input.appUrl)}">Open This week</a>`,
    ].filter(Boolean) as string[];
    const text = [
      `<b>LeadPulse · ${headerDate(today)}</b>`,
      ...gameLines(game),
      '',
      summary ? `Also: ${summary}` : 'Nothing else due today.',
      ...(links.length ? ['', ...links] : []),
    ].join('\n');
    const buttons = runButtons(game.run);
    return { text, isEmpty, counts, ...(buttons.length ? { buttons } : {}) };
  }

  const lines = [
    `<b>LeadPulse · ${headerDate(today)}</b>`,
    summary || 'Nothing due today.',
    ...list(
      'Waiting on you',
      waiting.slice(0, LIST_LIMIT).map(item => `<b>${escapeHtml(item.name)}</b> · ${escapeHtml(item.label)}`),
      waiting.length,
    ),
    ...list('Due today', dueToday.slice(0, LIST_LIMIT).map(item => followupRow(item)), dueToday.length),
    ...list(
      'Overdue',
      overdue.slice(0, LIST_LIMIT).map(item => followupRow(item, `${daysOverdue(item.dueDate, today)}d`)),
      overdue.length,
    ),
    // A question, not a change: parking stays Pat's call, from the Pipeline filter it links to.
    ...list(
      'Park this deal?',
      parkSuggested.slice(0, LIST_LIMIT).map(item => `<b>${escapeHtml(item.name)}</b> · ${escapeHtml(item.label)}`),
      parkSuggested.length,
    ),
    ...(parkSuggested.length > 0 && input.appUrl
      ? [`<a href="${escapeHtml(`${input.appUrl}/deals?filter=park-suggested`)}">Review on Pipeline</a>`]
      : []),
    ...list(
      'Funding',
      growth.slice(0, LIST_LIMIT).map(item => [
        `<b>${escapeHtml(item.name)}</b>`,
        item.daysLate > 0 ? `${item.daysLate}d late` : 'today',
        item.step?.trim() && escapeHtml(item.step.trim()),
      ].filter(Boolean).join(' · ')),
      growth.length,
    ),
    ...(growth.length > 0 && input.appUrl
      ? [`<a href="${escapeHtml(`${input.appUrl}/growth`)}">Open Growth</a>`]
      : []),
    ...(counts.checkIns > 0
      ? ['', `<b>Customer check-ins</b>`, `${counts.checkIns} due${checkInDetail ? ` (${checkInDetail})` : ''}`]
      : []),
    ...(input.appUrl ? ['', `<a href="${escapeHtml(input.appUrl)}">Open This week</a>`] : []),
  ];

  return { text: lines.join('\n'), isEmpty, counts };
}

export interface AfternoonNudge {
  /** Telegram HTML (b, a) with every value escaped. */
  text: string;
  buttons?: InlineButton[][];
  /** Nothing due today is still open and no buyer is waiting: no message is sent. */
  isEmpty: boolean;
  counts: { waiting: number; dueToday: number };
}

/**
 * The 16:00 nudge. Follow-ups carry a date, not a time, so "due now" means due today and
 * still not handled: logging the touch moves the follow-up date and takes it off this list.
 * Overdue items and check-ins stay in the morning digest only.
 */
export function buildAfternoonNudge(input: {
  queue: ThisWeekQueue;
  waiting: readonly DigestWaiting[];
  today: string;
  appUrl?: string | null;
  /** With it, a day with nothing logged yet also gets the nudge, with the run's buttons. */
  game?: GameDigest | null;
}): AfternoonNudge {
  const { queue, waiting, today, game } = input;
  const dueToday = queue.dueThisWeek.filter(item => item.holds.length === 0 && item.dueDate === today);
  const counts = { waiting: waiting.length, dueToday: dueToday.length };
  // Nothing logged yet today and the run still has steps: one touch keeps the streak.
  const quietDay = Boolean(game && game.touchesToday === 0 && game.run.length > 0);
  const isEmpty = counts.waiting === 0 && counts.dueToday === 0 && !quietDay;

  const summary = [
    counts.dueToday > 0 && `${counts.dueToday} due today still open`,
    counts.waiting > 0 && `${counts.waiting} waiting on you`,
  ].filter(Boolean).join(' · ');

  const streakNote = quietDay && game
    ? (game.streak.current > 0
      ? `Nothing logged yet today. One touch keeps your ${game.streak.current}-day streak.`
      : 'Nothing logged yet today. One touch starts a new streak.')
    : null;

  const lines = [
    `<b>Before you close the day</b>`,
    ...(streakNote ? [streakNote] : []),
    ...(summary || !streakNote ? [summary || 'Nothing left open today.'] : []),
    ...list('Due today', dueToday.slice(0, LIST_LIMIT).map(item => followupRow(item)), dueToday.length),
    ...list(
      'Waiting on you',
      waiting.slice(0, LIST_LIMIT).map(item => `<b>${escapeHtml(item.name)}</b> · ${escapeHtml(item.label)}`),
      waiting.length,
    ),
    ...(quietDay && game ? list("Still in today's run", game.run.map(runLine), game.run.length) : []),
    ...(input.appUrl ? ['', `<a href="${escapeHtml(input.appUrl)}">Open This week</a>`] : []),
  ];

  const buttons = quietDay && game ? runButtons(game.run) : [];
  return { text: lines.join('\n'), isEmpty, counts, ...(buttons.length ? { buttons } : {}) };
}
