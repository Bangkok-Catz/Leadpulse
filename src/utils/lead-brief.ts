// ─── Lead brief: one card that answers "why them, who decides, how do I reach them, what now" ───
// Pure. Everything a lead's brief says comes from what LeadPulse already holds: Laya's fit, the
// account's own words, its contacts and the sources their names came from, the touches logged,
// and owner proposals waiting for Pat. Nothing is guessed: a missing fact is shown as missing,
// and the advised step is then to find it.
//
// "Verified" here is a ladder, not a badge. A decision maker climbs it one fact at a time:
//   Named → Source checked → Own channel → Replied
// Source checked means the name was saved from a page that publishes it (enrichment_evidence,
// approved by Pat). Own channel follows the reach-the-owner rule: their LINE, phone or email,
// not the shop's.

import type { Company, Contact, Deal, Meeting } from '../types/crm';
import { FIT_LABELS, percent, type CompanyFit, type EvidenceRow } from './account-profile.ts';
import { isCompanyRoute } from './contact-identity.ts';
import { countsTowardUnansweredChase } from './interaction-event.ts';
import { dayLabel, type EnrichmentProposal } from './proposals.ts';
import { DECIDER, TOUCH_LIMIT, bestRoute, isOpenLead, nextDue, notNowDate, touchLabel, type Route } from './prospecting.ts';
import { noteFacts } from './sweep.ts';

export type LadderStep = 'named' | 'sourced' | 'channel' | 'replied';

export const LADDER: { key: LadderStep; label: string }[] = [
  { key: 'named', label: 'Named' },
  { key: 'sourced', label: 'Source checked' },
  { key: 'channel', label: 'Own channel' },
  { key: 'replied', label: 'Replied' },
];

export interface Decider {
  contact: Contact;
  role: string | null;
  /** which rungs are true; a rung can be true while a lower one is not (a hand-added owner has no source) */
  steps: Record<LadderStep, boolean>;
  /** how many rungs are true, 1..4 */
  level: number;
  /** the page the name was saved from, when there is one */
  source: EvidenceRow | null;
  /** "LINE", "phone" or "email": their own, never the shop's */
  channel: string | null;
}

export type AdviceKind = 'decide_owner' | 'find_way_in' | 'first_touch' | 'follow_up' | 'wait' | 'park';

export interface Advice {
  kind: AdviceKind;
  /** what to do, in a few words: "Send the first message · May on LINE" */
  action: string;
  /** why this and not something else, one sentence */
  reason: string;
  /** the day it is due; null when it is due now */
  due: string | null;
  /** the one missing fact that would make this lead stronger, when the step above isn't already that */
  also: string | null;
}

export interface LeadBrief {
  fit: { label: string; fits: boolean | null; why: string | null };
  decider: Decider | null;
  /** an owner the search found, waiting for Pat's Save */
  proposed: { id: string; name: string; role: string | null; sourceUrl: string } | null;
  route: Route | null;
  touches: number;
  lastTouch: string | null;
  advice: Advice;
}

const own = (c: Contact): string | null =>
  c.line?.trim() ? 'LINE' : c.phone?.trim() ? 'phone' : c.email?.trim() ? 'email' : null;

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

export const firstName = (name: string | null | undefined): string => {
  const n = (name ?? '').trim().replace(/^(khun|คุณ|mr\.?|ms\.?|mrs\.?|dr\.?)\s+/i, '');
  return n.split(/\s+/)[0] || n;
};

/** The account's decision maker: the one Pat tagged, else a person whose title says they decide.
 *  With several, the one furthest up the ladder. Company routes are never people. */
export function findDecider(
  company: Company,
  contacts: readonly Contact[],
  meetings: readonly Meeting[],
  evidence: readonly EvidenceRow[],
): Decider | null {
  const people = contacts.filter(c => c.company_id === company.id && !isCompanyRoute(c));
  const deciders = people.filter(c => c.id === company.decision_maker_contact_id || DECIDER.test(c.job_title ?? ''));
  if (deciders.length === 0) return null;
  const ranked = deciders.map((contact) => {
    const source = evidence
      .filter(e => e.entity_type === 'contact' && e.entity_id === contact.id && e.field === 'name' && sameText(e.value, contact.name))
      .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))[0] ?? null;
    const channel = own(contact);
    const steps: Record<LadderStep, boolean> = {
      named: true,
      sourced: Boolean(source),
      channel: Boolean(channel),
      replied: contact.status === 'replied'
        || meetings.some(m => m.direction === 'inbound' && (m.contact_ids ?? []).includes(contact.id)),
    };
    const level = LADDER.filter(s => steps[s.key]).length;
    return { contact, role: contact.job_title?.trim() || null, steps, level, source, channel };
  });
  // Pat's own tag wins a tie: he said who decides.
  ranked.sort((a, b) => b.level - a.level
    || Number(b.contact.id === company.decision_maker_contact_id) - Number(a.contact.id === company.decision_maker_contact_id));
  return ranked[0];
}

/** Who a draft should be addressed to: a person already on the deal, else the decision maker. */
export function draftRecipient(deal: Deal, company: Company | undefined, contacts: readonly Contact[]): Contact | null {
  const onDeal = contacts.find(c => (deal.contact_ids ?? []).includes(c.id) && !isCompanyRoute(c));
  if (onDeal) return onDeal;
  return company ? findDecider(company, contacts, [], [])?.contact ?? null : null;
}

function fitLine(company: Company, fit: CompanyFit | null): LeadBrief['fit'] {
  const facts = noteFacts(company.notes);
  const makes = company.what_they_make?.trim();
  const why = makes ? `Makes ${makes}` : facts.why;
  if (!fit) return { label: 'Not graded yet', fits: null, why };
  return fit.fits
    ? { label: `${FIT_LABELS[fit.best.archetype].short} fit ${percent(fit.best.noul)}`, fits: true, why }
    : { label: `No fit · best ${percent(fit.best.noul)}`, fits: false, why };
}

function advise(input: {
  company: Company;
  decider: Decider | null;
  proposed: LeadBrief['proposed'];
  route: Route | null;
  touches: number;
  lastTouch: string | null;
  followupDate: string | null;
  today: string;
}): Advice {
  const { company, decider, proposed, route, touches, lastTouch, today } = input;
  const who = decider ? firstName(decider.contact.name) : null;
  // The one missing fact, said once, under whatever the step is.
  const gap = !decider
    ? (proposed ? null : 'No owner on file yet: the owner search looks on Tue and Thu.')
    : !decider.channel ? `Find ${who}'s own LINE, Instagram or mobile.` : null;

  if (touches >= TOUCH_LIMIT) {
    return {
      kind: 'park', action: `Park it · back ${dayLabel(notNowDate(today))}`,
      reason: `${TOUCH_LIMIT} touches and no reply. A sixth rarely changes that; try again in two months.`,
      due: null, also: null,
    };
  }
  if (proposed && !decider) {
    return {
      kind: 'decide_owner', action: `Decide on ${proposed.name}${proposed.role ? `, ${proposed.role}` : ''}`,
      reason: 'The owner search found them on a published page. Save adds them as a contact, so the first message can go to a person.',
      due: null, also: null,
    };
  }
  if (!route) {
    return {
      kind: 'find_way_in', action: 'Find a way in',
      reason: company.website?.trim()
        ? 'No LINE, phone, email or address on file. Their website is saved: its contact page is the first place to look.'
        : 'No LINE, phone, email, address or website on file, so there is nothing to send to yet.',
      due: null, also: decider ? gap : 'The owner search looks on Tue and Thu.',
    };
  }
  const next = touches + 1;
  const due = nextDue(touches, lastTouch, input.followupDate, today);
  if (due > today) {
    return {
      kind: 'wait', action: `Wait until ${dayLabel(due)}`,
      reason: `Touch ${touches} went out ${lastTouch ? dayLabel(lastTouch) : 'recently'}. Next is ${touchLabel(next, route).replace(/^Touch \d of \d · /, 'the ')}.`,
      due, also: gap,
    };
  }
  const step = touchLabel(next, route).replace(/^Touch \d of \d · /, '');
  const action = `${touches === 0 ? 'Send the first message' : step.charAt(0).toUpperCase() + step.slice(1)} · ${route.label}`;
  const reason = route.kind === 'owner'
    ? (decider && route.contact?.id === decider.contact.id
      ? `${who} decides and you have their own ${decider.channel}.`
      : `${firstName(route.contact?.name)} is a named person there, which gets further than the shop's general channel.`)
    : route.kind === 'shop'
      ? (decider
        ? `No personal channel for ${who} yet, so go through the shop and ask for them by name.`
        : 'No owner on file. Use the shop channel to ask who decides on butter, and save the name.')
      : 'No channel on file, only an address. A sample in hand is the opener.';
  return { kind: touches === 0 ? 'first_touch' : 'follow_up', action, reason, due: null, also: route.kind === 'owner' ? null : gap };
}

/**
 * The brief for one open lead, or null when the deal is not a lead any more (the buyer
 * answered, the deal is closed or parked, or the account is already a customer).
 */
export function buildLeadBrief(input: {
  deal: Deal;
  company: Company | undefined;
  contacts: readonly Contact[];
  meetings: readonly Meeting[];
  evidence?: readonly EvidenceRow[];
  proposals?: readonly EnrichmentProposal[];
  fit?: CompanyFit | null;
  today: string;
}): LeadBrief | null {
  const { deal, company, today } = input;
  const meetings = input.meetings as Meeting[];
  if (!company || !isOpenLead(deal, company, meetings)) return null;
  const contacts = input.contacts.filter(c => c.company_id === company.id);
  const decider = findDecider(company, contacts, meetings.filter(m => m.company_id === company.id || m.deal_id === deal.id), input.evidence ?? []);
  const waiting = (input.proposals ?? []).find(p => p.field === 'decision_maker' && p.status === 'pending' && p.company_id === company.id);
  const proposed = waiting
    ? { id: waiting.id, name: waiting.value, role: waiting.details?.job_title?.trim() || null, sourceUrl: waiting.source_url }
    : null;
  const route = bestRoute(company, contacts as Contact[]);
  const sends = meetings.filter(m => m.deal_id === deal.id && countsTowardUnansweredChase(m));
  const lastTouch = sends.map(m => m.date?.slice(0, 10)).filter(Boolean).sort().at(-1) ?? null;
  return {
    fit: fitLine(company, input.fit ?? null),
    decider,
    proposed,
    route,
    touches: sends.length,
    lastTouch,
    advice: advise({ company, decider, proposed, route, touches: sends.length, lastTouch, followupDate: deal.followup_date ?? null, today }),
  };
}
