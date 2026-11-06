// ─── Today's leads: which prospects to contact today, how, and which touch is next ───
// Pure. A lead is a prospect's open deal in Outreach or Waiting on reply that the buyer has
// not answered yet. Each gets the best way in (the owner personally first, then the shop's
// own channel asking for the owner, then a visit) and a five-touch plan; a reply makes it a
// Pipeline deal like any other. Saving lives in components/TodaysLeads.tsx.

import type { Company, Contact, Deal, Meeting, MeetingType } from '../types/crm';
import { isCompanyRoute } from './contact-identity.ts';
import { addDaysToDateKey, getWorkflowAction } from './deal-workflow.ts';
import { countsTowardUnansweredChase } from './interaction-event.ts';

export const TOUCH_LIMIT = 5;
/** Days to wait after touch 1, 2, 3, 4 before the next one; after touch 5, before "Not now". */
export const TOUCH_GAPS = [2, 5, 7, 7, 7] as const;
export const NOT_NOW_DAYS = 60;
export const LEADS_PER_DAY = 5;
/** Of each day's leads, this many are kept for new ones, so a backlog of follow-ups never crowds out fresh shops. */
export const NEW_SLOTS = 2;

export const TOUCH_STEP: Record<number, string> = {
  1: 'first message',
  2: 'gentle follow-up',
  3: 'second follow-up',
  4: 'visit or call',
  5: 'last try',
};

export type LeadStage = 'new' | 'attempting';

export interface Route {
  kind: 'owner' | 'shop' | 'visit';
  type: MeetingType;
  /** the contact the touch goes to; null for a visit */
  contact: Contact | null;
  /** "Mali · LINE", "Shop LINE · ask for the owner", "Visit · ask for Khun May" */
  label: string;
}

export interface Lead {
  deal: Deal;
  company: Company;
  stage: LeadStage;
  /** touches made so far (unanswered sends) */
  touches: number;
  lastTouch: string | null;
  /** the next touch's number, 1..5; 6 means all five are done: time for "Not now" */
  next: number;
  due: string;
  route: Route;
  fit: number | null;
}

export interface TodaysLeads {
  /** due today, at most `limit`: follow-ups first (oldest due first), with NEW_SLOTS kept for new leads by fit */
  today: Lead[];
  /** due today beyond the limit */
  more: Lead[];
  /** leads with no way in yet, waiting for the owner search */
  waiting: { deal: Deal; company: Company }[];
  /** every deal counted here, so This week's follow-up lists don't show it twice */
  dealIds: Set<string>;
  /** open leads not contacted yet */
  fresh: number;
}

const DECIDER = /owner|founder|ceo|director|managing|\bmd\b|\bgm\b|general manager|proprietor|เจ้าของ|ผู้จัดการ/i;
const PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2 };

const firstName = (name: string | null | undefined) => {
  const n = (name ?? '').trim().replace(/^(khun|คุณ)\s*/i, '');
  return n.split(/\s+/)[0] || null;
};

/** The best way in: the decision maker's own LINE/phone/email, any named person's, the shop's
 *  own channel (asking for the owner by name when one is known), then a visit. */
export function bestRoute(company: Company, contacts: Contact[]): Route | null {
  const mine = contacts.filter(c => c.company_id === company.id);
  const people = mine.filter(c => !isCompanyRoute(c)).sort((a, b) => Number(DECIDER.test(b.job_title ?? '')) - Number(DECIDER.test(a.job_title ?? '')));
  const shop = mine.filter(c => isCompanyRoute(c));
  const owner = people[0] ?? null;
  const ask = owner ? `ask for ${owner.name.trim()}` : 'ask for the owner';
  for (const p of people) {
    const who = firstName(p.name) ?? p.name;
    if (p.line?.trim()) return { kind: 'owner', type: 'dm', contact: p, label: `${who} · LINE` };
    if (p.phone?.trim()) return { kind: 'owner', type: 'call', contact: p, label: `${who} · phone` };
    if (p.email?.trim()) return { kind: 'owner', type: 'email', contact: p, label: `${who} · email` };
  }
  for (const s of shop) {
    if (s.line?.trim()) return { kind: 'shop', type: 'dm', contact: s, label: `Shop LINE · ${ask}` };
    if (s.phone?.trim()) return { kind: 'shop', type: 'call', contact: s, label: `Shop phone · ${ask}` };
    if (s.email?.trim()) return { kind: 'shop', type: 'email', contact: s, label: `Shop email · ${ask}` };
  }
  if (company.address?.trim()) {
    return { kind: 'visit', type: 'meeting', contact: null, label: owner ? `Visit · ${ask}` : 'Visit · drop by with a sample' };
  }
  return null;
}

/** What the next touch is, in a few words: "Touch 2 of 5 · gentle follow-up". */
export function touchLabel(next: number, route: Route): string {
  if (next > TOUCH_LIMIT) return 'No reply after 5 touches';
  const step = next === 1 && route.type === 'call' ? 'call'
    : next === 1 && route.kind === 'visit' ? 'drop by with a sample'
      : TOUCH_STEP[next];
  return `Touch ${next} of ${TOUCH_LIMIT} · ${step}`;
}

/** When the touch after `touches` is due, from the last touch (a later follow-up date Pat set wins). */
export function nextDue(touches: number, lastTouch: string | null, followupDate: string | null, today: string): string {
  if (touches === 0 || !lastTouch) return today;
  const planned = addDaysToDateKey(lastTouch, TOUCH_GAPS[Math.min(touches, TOUCH_GAPS.length) - 1]);
  return followupDate && followupDate > planned ? followupDate : planned;
}

export function isOpenLead(deal: Deal, company: Company | undefined, meetings: Meeting[]): boolean {
  if (!company || company.status !== 'prospect') return false;
  if (deal.stage === 'closed_won' || deal.stage === 'closed_lost' || deal.park_reason) return false;
  const lane = getWorkflowAction(deal);
  if (lane !== 'outreach' && lane !== 'reply') return false;
  if (deal.buyer_reply?.trim()) return false;
  return !meetings.some(m => m.deal_id === deal.id && m.direction === 'inbound');
}

export function buildTodaysLeads(input: {
  deals: Deal[];
  companies: Company[];
  contacts: Contact[];
  meetings: Meeting[];
  fits: Map<string, number>;
  today: string;
  limit?: number;
}): TodaysLeads {
  const limit = input.limit ?? LEADS_PER_DAY;
  const companies = new Map(input.companies.map(c => [c.id, c]));
  const due: Lead[] = [];
  const waiting: TodaysLeads['waiting'] = [];
  const dealIds = new Set<string>();
  let fresh = 0;

  for (const deal of input.deals) {
    const company = deal.company_id ? companies.get(deal.company_id) : undefined;
    if (!company || !isOpenLead(deal, company, input.meetings)) continue;
    dealIds.add(deal.id);
    const sends = input.meetings.filter(m => m.deal_id === deal.id && countsTowardUnansweredChase(m));
    const touches = sends.length;
    if (touches === 0) fresh++;
    const route = bestRoute(company, input.contacts);
    if (!route) {
      waiting.push({ deal, company });
      continue;
    }
    const lastTouch = sends.map(m => m.date?.slice(0, 10)).filter(Boolean).sort().at(-1) ?? null;
    const when = nextDue(touches, lastTouch, deal.followup_date ?? null, input.today);
    if (when > input.today) continue;
    due.push({
      deal, company, route, touches, lastTouch,
      stage: touches === 0 ? 'new' : 'attempting',
      next: touches + 1,
      due: when,
      fit: input.fits.get(company.id) ?? null,
    });
  }

  // Follow-ups on leads already contacted come first (oldest first): a second touch is what
  // turns a message into a conversation. Then new leads, Laya's best fits first.
  due.sort((a, b) => {
    if (a.stage !== b.stage) return a.stage === 'attempting' ? -1 : 1;
    if (a.stage === 'attempting' && a.due !== b.due) return a.due < b.due ? -1 : 1;
    const fit = (b.fit ?? -1) - (a.fit ?? -1);
    if (fit) return fit;
    const pr = (PRIORITY[a.deal.priority ?? 'medium'] ?? 1) - (PRIORITY[b.deal.priority ?? 'medium'] ?? 1);
    if (pr) return pr;
    return a.company.name.localeCompare(b.company.name);
  });
  waiting.sort((a, b) => (input.fits.get(b.company.id) ?? -1) - (input.fits.get(a.company.id) ?? -1));
  const chasing = due.filter(l => l.stage === 'attempting');
  const newLeads = due.filter(l => l.stage === 'new');
  const newSlots = Math.min(newLeads.length, Math.min(NEW_SLOTS, limit));
  const today = [...chasing.slice(0, limit - newSlots), ...newLeads.slice(0, newSlots)];
  const shown = new Set(today);
  const pick = [...today, ...due.filter(l => !shown.has(l))].slice(0, limit);
  return { today: pick, more: due.filter(l => !new Set(pick).has(l)), waiting, dealIds, fresh };
}

/** The deal fields a logged touch sets: the next touch's date and what it is. */
export function afterTouch(lead: Lead, today: string): { followup_date: string; next_action: string } {
  const done = lead.next;
  if (done >= TOUCH_LIMIT) {
    return { followup_date: addDaysToDateKey(today, TOUCH_GAPS[TOUCH_GAPS.length - 1]), next_action: 'No reply after 5 touches: Not now?' };
  }
  return {
    followup_date: addDaysToDateKey(today, TOUCH_GAPS[done - 1]),
    next_action: `${touchLabel(done + 1, lead.route)}`,
  };
}

/** The logged touch's title: "Touch 1 of 5 · first message (Shop LINE)". */
export function touchTitle(lead: Lead): string {
  const via = lead.route.kind === 'visit' ? 'visit' : lead.route.label.split(' · ')[0];
  return `${touchLabel(lead.next, lead.route)} (${via})`;
}

export const notNowDate = (today: string) => addDaysToDateKey(today, NOT_NOW_DAYS);
