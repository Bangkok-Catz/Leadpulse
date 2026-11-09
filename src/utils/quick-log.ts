// ─── One-tap logging ───
// Pure. What a step's button saves when Pat taps it: the touch row, and the deal change the
// log form would make for the same event. Shared by This week's rows and the Telegram
// buttons, so a tap saves the same thing wherever it happens.
//
//   Sample sent      → a sample touch is logged and the Sample lane's playbook sets "Check the
//                      sample arrived" in 3 days. The deal moves to Sample (sent); one already
//                      in Testing stays there with its sample marked sent.
//   Messaged/Called… → an outbound touch; a deal still at Reach out moves to Waiting on
//                      reply (as the lead button does), and the next follow-up is +3 days.
//   They replied     → an inbound touch; the buyer's words (if pasted) replace the saved reply.
//                      The date is left alone: the deal is now waiting on Pat.
//   On a regular (a check-in, no deal) only the touch is logged.
// A follow-up date chosen afterwards (+3 days, +1 week, none) is a separate patch.

import type { Deal, DealWorkflowAction, Meeting, MeetingType } from '@/types/crm';
import { actionChannel } from './action-channel';
import { buyerReplyUpdate } from './buyer-reply';
import { addDaysToDateKey, getWorkflowAction } from './deal-workflow';
import { SUGGESTED_FOLLOWUP_DAYS } from './followup-suggestion';
import { buildInteractionWorkflowUpdate } from './interaction-workflow';
import { buildLaneGateDecision } from './lane-gate';
import { LANE_PLAYBOOKS } from './lane-playbook';

export type QuickKind = 'sample' | 'dm' | 'call' | 'no_answer' | 'email' | 'visit' | 'reply';

export interface QuickChoice {
  id: QuickKind;
  /** past tense, what Pat did: the button's words */
  label: string;
  type: MeetingType;
  direction: 'outbound' | 'inbound';
}

export const QUICK: Record<QuickKind, QuickChoice> = {
  sample: { id: 'sample', label: 'Sample sent', type: 'sample_sent', direction: 'outbound' },
  dm: { id: 'dm', label: 'Messaged', type: 'dm', direction: 'outbound' },
  call: { id: 'call', label: 'Called', type: 'call', direction: 'outbound' },
  no_answer: { id: 'no_answer', label: 'Called, no answer', type: 'call', direction: 'outbound' },
  email: { id: 'email', label: 'Emailed', type: 'email', direction: 'outbound' },
  visit: { id: 'visit', label: 'Visited', type: 'meeting', direction: 'outbound' },
  reply: { id: 'reply', label: 'They replied', type: 'dm', direction: 'inbound' },
};

/** Days to the next follow-up after a message, call, email or visit. */
export const QUICK_FOLLOWUP_DAYS = SUGGESTED_FOLLOWUP_DAYS;
/** Days to checking a sample arrived: the Sample lane's own playbook. */
export const SAMPLE_CHECK_DAYS = LANE_PLAYBOOKS.sample?.days ?? 3;

/** A step that is itself sending a sample ("Send samples for testing", "Deliver butter samples"),
 *  not one that only mentions it ("Check sample feedback"). */
const SEND_SAMPLE = /\b(send|sending|deliver|ship|post|bring|drop\s+(?:off|by))\b[^.;]{0,30}\bsamples?\b|ส่ง[^.;]{0,12}ตัวอย่าง/i;
/** A won or parked deal is closed; any open deal can still have a sample go out. */
const CLOSED_LANES: readonly DealWorkflowAction[] = ['success', 'parked'];

export function canSendSample(deal: Pick<Deal, 'workflow_action' | 'stage'> | null | undefined): boolean {
  return Boolean(deal && !CLOSED_LANES.includes(getWorkflowAction(deal as Deal)));
}

/** The step's own way of being done, read from its wording ("Call John" → Called). */
export function primaryKind(action: string | null | undefined, deal?: Pick<Deal, 'workflow_action' | 'stage'> | null): QuickKind {
  if (action && SEND_SAMPLE.test(action) && canSendSample(deal)) return 'sample';
  switch (actionChannel(action)) {
    case 'call': return 'call';
    case 'email': return 'email';
    case 'meeting': return 'visit';
    default: return 'dm';
  }
}

/** The other ways to log a step, for its ▾ menu. "They replied" leads on a deal. */
export function otherKinds(primary: QuickKind, deal?: Pick<Deal, 'workflow_action' | 'stage'> | null): QuickKind[] {
  const list: QuickKind[] = deal
    ? ['reply', 'dm', 'call', 'no_answer', 'email', ...(canSendSample(deal) ? ['sample' as const] : []), 'visit']
    : ['dm', 'call', 'no_answer', 'email', 'visit'];
  return list.filter(kind => kind !== primary);
}

export type NewMeeting = Omit<Meeting, 'id' | 'created_at'>;

export interface QuickLog {
  meeting: NewMeeting;
  /** the deal change; empty for a regular's check-in */
  dealPatch: Partial<Deal>;
  /** the deal's values before, for every field the patch changes (Undo) */
  before: Partial<Deal>;
  /** the follow-up this log sets, if any */
  followupDate: string | null;
}

export interface QuickLogInput {
  kind: QuickKind;
  today: string;
  /** the deal the step belongs to; a check-in has none */
  deal?: Deal | null;
  /** the account, when there is no deal */
  companyId?: string | null;
  /** the buyer's words, for "They replied" */
  words?: string | null;
  contactIds?: string[];
}

function beforeOf(deal: Deal, patch: Partial<Deal>): Partial<Deal> {
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) before[key] = (deal as unknown as Record<string, unknown>)[key] ?? null;
  return before as Partial<Deal>;
}

export function buildQuickLog(input: QuickLogInput): QuickLog {
  const { kind, today, deal } = input;
  const choice = QUICK[kind];
  const contactIds = input.contactIds ?? [];

  if (!deal) {
    // A regular's check-in: the touch is the whole record.
    return {
      meeting: {
        description: choice.label, type: choice.type, date: today, company_id: input.companyId ?? null,
        contact_ids: contactIds, deal_id: null, product: 'Butter', summary: null,
        outcome: kind === 'no_answer' ? 'no_response' : null, followup_date: null, direction: choice.direction,
      },
      dealPatch: {}, before: {}, followupDate: null,
    };
  }

  if (kind === 'sample') {
    if (!canSendSample(deal)) throw new Error('This deal is closed. Open it to log what happened.');
    const followupDate = addDaysToDateKey(today, SAMPLE_CHECK_DAYS);
    // Testing already counts as further along: the deal stays there with its sample marked sent.
    const { updates, meeting } = buildLaneGateDecision(deal, {
      target: getWorkflowAction(deal) === 'testing' ? 'testing' : 'sample', sample_status: 'sent', followup_date: followupDate,
      next_action: LANE_PLAYBOOKS.sample?.nextAction ?? null, contact_ids: contactIds,
    }, { dateKey: today });
    const patch: Partial<Deal> = { ...updates, sample_status: 'sent', followup_date: followupDate };
    const sampleMeeting: NewMeeting = meeting ?? {
      description: QUICK.sample.label, type: 'sample_sent', date: today, company_id: deal.company_id, contact_ids: contactIds,
      deal_id: deal.id, product: deal.product || 'Butter', summary: null, outcome: null, followup_date: followupDate, direction: 'outbound',
    };
    return {
      meeting: { ...sampleMeeting, description: QUICK.sample.label, product: deal.product || 'Butter', followup_date: followupDate },
      dealPatch: patch, before: beforeOf(deal, patch), followupDate,
    };
  }

  const base = {
    date: today, company_id: deal.company_id ?? input.companyId ?? null, contact_ids: contactIds, deal_id: deal.id,
    product: deal.product || 'Butter', summary: null,
  };

  if (kind === 'reply') {
    const patch: Partial<Deal> = { ...buyerReplyUpdate(deal.buyer_reply, input.words) };
    return {
      meeting: { ...base, description: 'Client reply', type: choice.type, outcome: null, followup_date: null, direction: 'inbound' },
      dealPatch: patch, before: beforeOf(deal, patch), followupDate: null,
    };
  }

  const followupDate = addDaysToDateKey(today, QUICK_FOLLOWUP_DAYS);
  // A first touch on a deal at Reach out means it now waits on a reply, as the log form does.
  const lane = getWorkflowAction(deal) === 'outreach'
    ? buildInteractionWorkflowUpdate(deal, 'reply', { kind: 'outbound_attempt', outcome: null, interactionDescription: choice.label, channel: choice.type })
    : null;
  const patch: Partial<Deal> = { ...(lane ?? {}), followup_date: followupDate };
  return {
    meeting: {
      ...base, description: choice.label, type: choice.type,
      outcome: kind === 'no_answer' ? 'no_response' : null, followup_date: followupDate, direction: 'outbound',
    },
    dealPatch: patch, before: beforeOf(deal, patch), followupDate,
  };
}

/** The follow-up options offered after a tap, as days from today (null = no date). */
export const FOLLOWUP_OPTIONS: readonly { days: number | null; label: string }[] = [
  { days: 3, label: '+3 days' },
  { days: 7, label: '+1 week' },
  { days: null, label: 'No date' },
];

/** The deal patch for a follow-up chosen after the tap. */
export function followupPatch(today: string, days: number | null): Pick<Deal, 'followup_date'> {
  return { followup_date: days == null ? null : addDaysToDateKey(today, days) };
}
