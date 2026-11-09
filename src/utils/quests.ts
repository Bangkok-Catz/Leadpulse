// ─── Every step for This week, as plain data ───
// Pure. Builds the steps This week shows (buyers waiting on Pat, follow-ups, today's leads,
// customer check-ins, funding steps) with their points and how a tap logs each one. The
// page adds its icons, details and buttons; the Telegram messages use the same list, so the
// run on the phone is the run in the app.

import type { Deal, MeetingType } from '@/types/crm';
import { actionChannel } from './action-channel';
import { businessDaysBetween } from './business-time';
import { formatScheduleDate } from './deal-schedule';
import type { DoNextItem, DoNextKind } from './do-next';
import type { AttentionCandidate } from './followup-policy';
import { POINTS, questPoints, questWeight, shortAction, type PointsContext, type Quest } from './game';
import type { GrowthDue, GrowthItem } from './growth';
import { leadAction, leadChannel } from './lead-action';
import { TOUCH_LIMIT, type Lead, type TodaysLeads } from './prospecting';
import { otherKinds, primaryKind, type QuickKind } from './quick-log';
import type { ThisWeekQueue } from './this-week-queue';
import { daysOverdue } from './this-week-stats';

/** Reasons that mean someone is waiting on Pat. Stalled and missing-data reasons live on Pipeline. */
export const WAITING_KINDS: readonly DoNextKind[] = ['asked', 'review', 'waiting'];
const WAITING_TAG: Partial<Record<DoNextKind, string>> = { asked: 'Buyer asked', review: 'Needs a look', waiting: 'Buyer replied' };

type CheckInRow = ThisWeekQueue['checkIns'][number];
export type CheckInTier = NonNullable<CheckInRow['tier']> | 'reorder_only';

export const CHECK_IN: Record<CheckInTier, { tag: string; action: string }> = {
  at_risk: { tag: 'At risk', action: 'Check in before they go quiet' },
  dormant: { tag: 'Dormant', action: 'Win them back' },
  watch: { tag: 'Watch', action: 'Check in' },
  healthy: { tag: 'Regular', action: 'Check in' },
  reorder_only: { tag: 'Reorder due', action: 'Ask about a reorder' },
};

/** How a step is carried out, for its icon: a channel, a sample, a regular, funding or a lead's route. */
export type SeedChannel =
  | { key: 'call' | 'email' | 'message' | 'meeting' | 'sample' | 'regular' | 'funding'; label: string }
  | { key: 'route'; label: string; routeType: MeetingType };

export type QuestSource =
  | { type: 'waiting'; deal: Deal; reason: { kind: DoNextKind; label: string } }
  | { type: 'followup'; item: AttentionCandidate; deal: Deal | null; when: 'late' | 'due' | 'undated'; canLog: boolean }
  | { type: 'lead'; lead: Lead; owner: boolean; finished: boolean }
  | { type: 'checkin'; row: CheckInRow; tier: CheckInTier }
  | { type: 'funding'; item: GrowthItem; late: boolean };

export interface QuestSeed extends Quest {
  /** the step's whole saved wording; `action` is its short form */
  full: string;
  /** a calm word under the name: "Buyer replied", "At risk", "New lead" */
  tag: string | null;
  channel: SeedChannel | null;
  href: string | null;
  /** how one tap logs it; null when the row opens instead */
  quick: { primary: QuickKind; others: QuickKind[] } | null;
  source: QuestSource;
}

const CHANNEL_LABEL = { call: 'Call', email: 'Email', message: 'Message', meeting: 'Visit' } as const;
const SAMPLE = /sample|ตัวอย่าง/i;
/** A lead's route, as the button's words. */
const ROUTE_KIND: Partial<Record<MeetingType, QuickKind>> = { call: 'call', email: 'email', meeting: 'visit', dm: 'dm' };
const LEAD_KINDS: readonly QuickKind[] = ['dm', 'call', 'email', 'visit'];

export function shortDate(dateKey: string): string {
  return formatScheduleDate(dateKey).replace(/ \d{4}$/, '');
}

export function dueTag(dateKey: string, today: string): string {
  const offset = businessDaysBetween(today, dateKey);
  if (offset === 0) return 'Due today';
  if (offset === 1) return 'Due tomorrow';
  return `Due ${shortDate(dateKey)}`;
}

function channelFor(action: string | null | undefined): SeedChannel | null {
  if (action && SAMPLE.test(action)) return { key: 'sample', label: 'Sample' };
  const c = actionChannel(action);
  return c ? { key: c, label: CHANNEL_LABEL[c] } : null;
}

export function leadQuickKind(lead: Lead): QuickKind {
  return ROUTE_KIND[lead.route.type] ?? 'dm';
}

export interface QuestSeedInput {
  /** Do-next items already narrowed to WAITING_KINDS */
  waitingOnYou: readonly DoNextItem[];
  queue: Pick<ThisWeekQueue, 'overdue' | 'dueThisWeek' | 'needsDate' | 'checkIns'>;
  leads?: TodaysLeads;
  growth?: GrowthDue;
  today: string;
  dealsById: ReadonlyMap<string, Deal>;
  companyName: (companyId: string | null | undefined) => string | null | undefined;
  ctx: PointsContext;
  /** deals with a contact hold: shown, never logged in one tap */
  heldDealIds: ReadonlySet<string>;
}

export function buildQuestSeeds(input: QuestSeedInput): QuestSeed[] {
  const { waitingOnYou, queue, leads, growth, today, dealsById, companyName, ctx, heldDealIds } = input;
  const byKey = new Map<string, QuestSeed>();
  const add = (q: Omit<QuestSeed, 'weight'>) => {
    const existing = byKey.get(q.key);
    if (existing) {
      if (q.late > existing.late) byKey.set(q.key, { ...existing, late: q.late, weight: questWeight({ ...existing, late: q.late }) });
      return;
    }
    byKey.set(q.key, { ...q, weight: questWeight(q) });
  };
  const lateOf = new Map(queue.overdue.filter(c => c.dealId).map(c => [c.dealId!, daysOverdue(c.dueDate, today)]));
  const regular = (companyId: string | null | undefined) => Boolean(companyId && ctx.regulars.has(companyId));

  for (const item of waitingOnYou) {
    const { deal } = item;
    const reason = item.reasons[0];
    const name = companyName(deal.company_id) || deal.client || deal.title || 'Deal';
    const full = deal.next_action?.trim() || '';
    const action = shortAction(full) || 'Reply to the buyer';
    const primary = primaryKind(full || action, deal);
    add({
      key: `deal:${deal.id}`, kind: 'reply', name, action, full, dealId: deal.id, companyId: deal.company_id,
      late: lateOf.get(deal.id) ?? 0, points: questPoints('reply', full || action, regular(deal.company_id), false), bonus: 0,
      held: heldDealIds.has(deal.id), channel: channelFor(full || action) ?? { key: 'message', label: 'Message' },
      tag: WAITING_TAG[reason.kind] ?? null, href: `/deals?deal=${encodeURIComponent(deal.id)}`,
      quick: { primary, others: otherKinds(primary, deal) },
      source: { type: 'waiting', deal, reason },
    });
  }

  const followup = (item: AttentionCandidate, when: 'late' | 'due' | 'undated') => {
    const deal = item.dealId ? dealsById.get(item.dealId) ?? null : null;
    const name = item.companyName || item.dealTitle || 'Deal';
    const full = item.nextAction?.trim() || '';
    const action = shortAction(full) || (when === 'undated' ? 'Set a follow-up date' : 'Follow up');
    const canLog = when !== 'undated' && Boolean(item.dealId) && item.action === 'honor_saved_followup' && item.holds.length === 0;
    const primary = primaryKind(full || action, deal);
    add({
      key: item.dealId ? `deal:${item.dealId}` : `company:${item.companyId ?? item.id}`,
      kind: when, name, action, full, dealId: item.dealId, companyId: item.companyId,
      late: when === 'late' ? daysOverdue(item.dueDate, today) : 0,
      points: questPoints(when, full || action, regular(item.companyId), false), bonus: 0,
      held: item.holds.length > 0, channel: channelFor(full || action),
      tag: when === 'due' && item.dueDate ? dueTag(item.dueDate, today) : when === 'undated' ? 'No date' : item.priority === 'high' ? 'High priority' : null,
      href: item.dealId ? `/deals?deal=${encodeURIComponent(item.dealId)}` : item.companyId ? `/companies?company=${encodeURIComponent(item.companyId)}` : null,
      quick: canLog && deal ? { primary, others: otherKinds(primary, deal) } : null,
      source: { type: 'followup', item, deal, when, canLog },
    });
  };
  queue.overdue.forEach(item => followup(item, 'late'));
  queue.dueThisWeek.forEach(item => followup(item, 'due'));
  queue.needsDate.forEach(item => followup(item, 'undated'));

  for (const lead of [...(leads?.today ?? []), ...(leads?.more ?? [])]) {
    const action = leadAction(lead);
    const finished = lead.next > TOUCH_LIMIT;
    // The bonus is only promised when the route's contact is an owner or decision maker.
    const owner = Boolean(lead.route.contact && ctx.deciders.has(lead.route.contact.id));
    const primary = leadQuickKind(lead);
    add({
      key: `deal:${lead.deal.id}`, kind: 'lead', name: lead.company.name, action, full: action, dealId: lead.deal.id, companyId: lead.company.id,
      late: lead.stage === 'attempting' && lead.due < today ? daysOverdue(lead.due, today) : 0,
      points: finished ? 0 : questPoints('lead', action, false, owner), bonus: owner ? 0 : POINTS.owner, held: false,
      channel: { key: 'route', label: leadChannel(lead), routeType: lead.route.type },
      tag: lead.stage === 'new' ? 'New lead' : null,
      href: `/companies?company=${encodeURIComponent(lead.company.id)}`,
      quick: finished ? null : { primary, others: LEAD_KINDS.filter(kind => kind !== primary) },
      source: { type: 'lead', lead, owner, finished },
    });
  }

  for (const row of queue.checkIns) {
    const tierKey: CheckInTier = row.tier ?? 'reorder_only';
    const tier = CHECK_IN[tierKey];
    const late = row.dueDate ? daysOverdue(row.dueDate, today) : 0;
    const primary = primaryKind(tier.action, null);
    add({
      key: `company:${row.companyId}`, kind: 'checkin', name: row.companyName, action: tier.action, full: tier.action, dealId: null, companyId: row.companyId,
      late, points: questPoints('checkin', tier.action, true, false), bonus: 0, held: false,
      channel: { key: 'regular', label: 'Regular' },
      tag: row.reorder && !row.dueDate ? `${row.reorder.severityDays}d past reorder` : tier.tag,
      href: `/companies?company=${encodeURIComponent(row.companyId)}`,
      quick: { primary, others: otherKinds(primary, null) },
      source: { type: 'checkin', row, tier: tierKey },
    });
  }

  const fundingRows = [...(growth?.overdue ?? []).map(g => ({ g, late: true })), ...(growth?.week ?? []).map(g => ({ g, late: false }))];
  for (const { g, late } of fundingRows) {
    const action = g.next_step?.trim() || 'Next step';
    add({
      key: `growth:${g.id}`, kind: 'funding', name: g.name, action, full: action, dealId: null, companyId: null,
      late: late && g.next_date ? daysOverdue(g.next_date, today) : 0, points: 0, bonus: 0, held: false,
      channel: { key: 'funding', label: 'Funding' }, tag: !late && g.next_date ? dueTag(g.next_date, today) : null,
      href: '/growth', quick: null,
      source: { type: 'funding', item: g, late },
    });
  }
  return [...byKey.values()];
}
