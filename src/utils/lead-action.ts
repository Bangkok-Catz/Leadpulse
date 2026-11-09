// ─── A lead's next step, in words, and what logging its touch saves ───
// Pure. Shared by This week's lead rows and the Telegram buttons.

import type { Deal, Meeting, MeetingType } from '@/types/crm';
import { getWorkflowAction } from './deal-workflow';
import { buildInteractionWorkflowUpdate } from './interaction-workflow';
import { TOUCH_LIMIT, afterTouch, touchTitle, type Lead } from './prospecting';

const STEP_WORDS: Record<number, string> = { 1: 'First message', 2: 'Gentle follow-up', 3: 'Second follow-up', 4: 'Visit or call', 5: 'Last try' };

/** The lead's next step in a few words: "First message on Shop LINE, ask for the owner". */
export function leadAction(lead: Lead): string {
  const { route } = lead;
  if (lead.next > TOUCH_LIMIT) return 'No reply after 5 touches: not now?';
  const step = STEP_WORDS[lead.next] ?? 'Follow up';
  const [where, rest] = route.label.split(' · ');
  if (route.kind === 'visit') return rest === 'drop by with a sample' ? 'Drop by with a sample' : `Visit, ${rest}`;
  if (route.kind === 'shop') return `${step} on ${where}, ${rest}`;
  if (route.type === 'call') return lead.next === 1 ? `Call ${where}` : `${step}: call ${where}`;
  if (route.type === 'email') return `${step} to ${where} by email`;
  return `${step} to ${where} on ${rest ?? 'LINE'}`;
}

/** The way in, short: "Shop LINE", "Mali", "Visit". */
export const leadChannel = (lead: Lead) => (lead.route.kind === 'visit' ? 'Visit' : lead.route.label.split(' · ')[0]);

export interface LeadTouch {
  title: string;
  meeting: Omit<Meeting, 'id' | 'created_at'>;
  dealPatch: Partial<Deal>;
  /** the deal's values before, for Undo */
  before: Partial<Deal>;
  followupDate: string;
}

/**
 * One touch on a lead, saved like the log form saves it: the deal then waits on a reply
 * (a first touch moves it from Reach out) with the next touch dated by the lead ladder.
 */
export function buildLeadTouch(lead: Lead, type: MeetingType, today: string): LeadTouch {
  const { deal } = lead;
  const title = touchTitle({ ...lead, route: { ...lead.route, type } });
  const next = afterTouch(lead, today);
  const lane = getWorkflowAction(deal) === 'outreach'
    ? buildInteractionWorkflowUpdate(deal, 'reply', { kind: 'outbound_attempt', outcome: null, interactionDescription: title, channel: type })
    : null;
  return {
    title,
    meeting: {
      description: title, type, date: today, company_id: lead.company.id,
      contact_ids: lead.route.contact ? [lead.route.contact.id] : [], deal_id: deal.id,
      product: deal.product || 'Butter', summary: null, outcome: null, followup_date: next.followup_date, direction: 'outbound',
    },
    dealPatch: { ...(lane ?? {}), ...next },
    before: {
      workflow_action: deal.workflow_action ?? null, stage: deal.stage, followup_date: deal.followup_date ?? null,
      next_action: deal.next_action ?? null, last_outcome: deal.last_outcome ?? null, park_reason: deal.park_reason ?? null,
      nudge_stage: deal.nudge_stage ?? null,
    },
    followupDate: next.followup_date,
  };
}
