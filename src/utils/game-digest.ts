// ─── The game, for the Telegram messages ───
// Pure. The streak, today's run and (on Mondays) last week, worked out from the same pieces
// This week uses, so the phone shows the run the app shows. One difference: LeadPulse's
// reading of buyer questions lives in the browser, so a buyer who asked something counts
// here as "buyer replied" (same step, a little less weight).

import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import type { InlineButton } from '@/lib/telegram';
import { addDaysToDateKey } from './deal-workflow';
import { buildDoNext } from './do-next';
import {
  RUN_SIZE, bestWeek, doneToday, isQuestDone, pickRun, pointsContext, streak as readStreak, touchesByDay, weekStart, type Streak,
} from './game';
import type { GrowthDue } from './growth';
import { laneTimelines, type LaneEvent } from './lane-time';
import type { TodaysLeads } from './prospecting';
import { QUICK, type QuickKind } from './quick-log';
import { WAITING_KINDS, buildQuestSeeds, type CheckInTier, type QuestSeed } from './quests';
import type { ThisWeekQueue } from './this-week-queue';

export interface GameDigest {
  streak: Streak;
  touchesToday: number;
  /** what is left of today's run, biggest step first */
  run: QuestSeed[];
  /** Mondays: last week's touches against the best week before it */
  lastWeek: { touches: number; best: number; bestStart: string | null } | null;
}

export function buildGameDigest(input: {
  deals: Deal[];
  companies: Company[];
  contacts: Contact[];
  meetings: Meeting[];
  events: LaneEvent[];
  queue: ThisWeekQueue;
  leads: TodaysLeads;
  growth?: GrowthDue;
  today: string;
  now: number;
}): GameDigest {
  const { deals, companies, contacts, meetings, queue, leads, today } = input;
  const ctx = pointsContext({ deals, companies, contacts });
  const days = touchesByDay(meetings);
  const touchesToday = days.get(today) ?? 0;
  const dealsById = new Map(deals.map(d => [d.id, d]));
  const companiesById = new Map(companies.map(c => [c.id, c]));
  const done = doneToday(meetings, today, ctx, {
    deal: id => { const d = dealsById.get(id); return (d?.company_id ? companiesById.get(d.company_id)?.name : null) ?? d?.client ?? d?.title ?? null; },
    company: id => companiesById.get(id)?.name ?? null,
  });

  // As on This week: a lead is worked from today's leads, so the dated lists leave it out.
  const notLead = (c: { dealId: string | null }) => !c.dealId || !leads.dealIds.has(c.dealId);
  const lists = { overdue: queue.overdue.filter(notLead), dueThisWeek: queue.dueThisWeek.filter(notLead), needsDate: queue.needsDate.filter(notLead), checkIns: queue.checkIns };
  const heldDealIds = new Set([...queue.needsReview, ...lists.overdue, ...lists.dueThisWeek, ...lists.needsDate]
    .filter(c => c.holds.length > 0 && c.dealId).map(c => c.dealId!));
  const timelines = laneTimelines(deals, input.events);
  const waitingOnYou = buildDoNext({ deals, meetings, grades: new Map(), timelines, today, now: input.now })
    .filter(item => WAITING_KINDS.includes(item.reasons[0].kind));

  const seeds = buildQuestSeeds({
    waitingOnYou, queue: lists, leads, growth: input.growth, today, dealsById,
    companyName: id => (id ? companiesById.get(id)?.name : null), ctx, heldDealIds,
  });
  const open = seeds.filter(q => !isQuestDone(q, done));
  const { run } = pickRun(open, Math.max(0, RUN_SIZE - touchesToday)) as unknown as { run: QuestSeed[] };

  let lastWeek: GameDigest['lastWeek'] = null;
  const thisWeek = weekStart(today);
  if (today === thisWeek) {
    const lastStart = addDaysToDateKey(thisWeek, -7);
    const touches = [...days].filter(([d]) => weekStart(d) === lastStart).reduce((sum, [, n]) => sum + n, 0);
    const best = bestWeek(new Map([...days].filter(([d]) => weekStart(d) < thisWeek)));
    lastWeek = { touches, best: best.count, bestStart: best.starts.at(-1) ?? null };
  }

  return { streak: readStreak(days, today), touchesToday, run, lastWeek };
}

/* ── Buttons: one tap on the phone logs the step the way the app does ── */

/** What a run button carries back: the way it was done and the step it belongs to. */
export type QuickTarget =
  | { type: 'deal'; dealId: string }
  | { type: 'lead'; dealId: string }
  | { type: 'company'; companyId: string; tier: CheckInTier };

const TIERS: readonly CheckInTier[] = ['at_risk', 'dormant', 'watch', 'healthy', 'reorder_only'];
const KINDS = Object.keys(QUICK) as QuickKind[];

/** "ql:<kind>:<d|l|c>:<id>[:<tier>]", within Telegram's 64-byte limit. */
export function quickCallback(kind: QuickKind, target: QuickTarget): string {
  if (target.type === 'company') return `ql:${kind}:c:${target.companyId}:${target.tier}`;
  return `ql:${kind}:${target.type === 'lead' ? 'l' : 'd'}:${target.dealId}`;
}

export function parseQuickCallback(data: string | undefined | null): { kind: QuickKind; target: QuickTarget } | null {
  const parts = (data ?? '').split(':');
  if (parts[0] !== 'ql' || parts.length < 4) return null;
  const kind = parts[1] as QuickKind;
  if (!KINDS.includes(kind)) return null;
  const id = parts[3];
  if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) return null;
  if (parts[2] === 'd') return { kind, target: { type: 'deal', dealId: id } };
  if (parts[2] === 'l') return { kind, target: { type: 'lead', dealId: id } };
  if (parts[2] === 'c' && TIERS.includes(parts[4] as CheckInTier)) return { kind, target: { type: 'company', companyId: id, tier: parts[4] as CheckInTier } };
  return null;
}

/** A tapped button, once logged: it stays as a tick and does nothing. */
export const LOGGED_CALLBACK = 'ql:done';

export function seedTarget(seed: QuestSeed): QuickTarget | null {
  const { source } = seed;
  if (source.type === 'checkin') return { type: 'company', companyId: source.row.companyId, tier: source.tier };
  if (source.type === 'lead') return { type: 'lead', dealId: source.lead.deal.id };
  return seed.dealId ? { type: 'deal', dealId: seed.dealId } : null;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** One button per run step that can be logged in one tap. */
export function runButtons(run: readonly QuestSeed[]): InlineButton[][] {
  const rows: InlineButton[][] = [];
  for (const seed of run) {
    const target = seedTarget(seed);
    if (!seed.quick || seed.held || !target) continue;
    rows.push([{ text: `✓ ${clip(seed.name, 26)} · ${QUICK[seed.quick.primary].label}`, callback_data: quickCallback(seed.quick.primary, target) }]);
  }
  return rows;
}
