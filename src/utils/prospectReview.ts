// ─── LeadPulse Intelligence — Prospect Review: shared, pure helpers ───
//
// This module is the ONLY place the Prospect Review screen derives its data.
// It deliberately mirrors scripts/prospect-fit-report.ts (the CLI) row-for-row, so
// the screen and the report cannot disagree about who is a candidate.
//
// Membership is deterministic (pre-gates in prospectFit.ts). Archetype fit is a
// Laya judgment made on explicit press — these helpers only SPLIT, ORDER and
// FILTER by that judgment; they never compute one, and they never rank by
// keyword.
//
// Two rules this file exists to enforce:
//   1. Nothing here hardcodes a count, a name, or a pilot finding. Everything is
//      computed from live CRM rows handed in by the caller.
//   2. Dimensions that have NO approved structured source are reported as
//      "not assessed", never as a fact. The local markdown pilot produced richer
//      dimensions (route quality, serviceability, relationship history, blockers)
//      and those are NOT app data.

import { CAMPAIGN_ARCHETYPES_V1 } from './campaignArchetypes.ts';
import {
  buildProspectFitReport,
  type ProspectFit,
  type ProspectFitReport,
  type ProspectJudgment,
  type ProspectSourceRow,
} from './prospectFit.ts';

// ─── Minimal structural inputs (satisfied by the CRM types at the call site) ───

export interface ReviewCompany {
  id: string;
  name: string;
  status: string;
  industry: string | null;
  tags: string[] | null;
  website: string | null;
}

export interface ReviewDeal {
  company_id?: string | null;
  stage: string;
}

export interface ReviewMeeting {
  company_id?: string | null;
  outcome?: string | null;
  direction?: string | null;
}

export interface ReviewEvent {
  company_id?: string | null;
}

export interface ReviewContact {
  company_id?: string | null;
  identity_quality?: string | null;
  email?: string | null;
  phone?: string | null;
  line?: string | null;
  instagram?: string | null;
  whatsapp?: string | null;
  job_title?: string | null;
  name?: string | null;
}

export interface ProspectReviewInput {
  companies: ReviewCompany[];
  deals: ReviewDeal[];
  meetings: ReviewMeeting[];
  events: ReviewEvent[];
  contacts: ReviewContact[];
}

/**
 * Build the evaluator's input rows from live CRM data.
 * Semantics MUST stay identical to scripts/prospect-fit-report.ts:
 *   - buying evidence = a `closed_won` deal OR any account_events row
 *   - internal workflow rows (direction 'internal' or null) are never engagement
 *   - an inbound row alone is a response, but only counts as a positive outcome
 *     when the outcome is recorded as 'positive'
 *   - "named" reachability requires identity_quality === 'named'
 *   - any of email/phone/LINE counts as a route, nothing else does
 */
export function buildProspectSourceRows(input: ProspectReviewInput): ProspectSourceRow[] {
  const won = new Map<string, number>();
  for (const d of input.deals) {
    if (d.company_id && d.stage === 'closed_won') won.set(d.company_id, (won.get(d.company_id) ?? 0) + 1);
  }

  const events = new Map<string, number>();
  for (const e of input.events) {
    if (e.company_id) events.set(e.company_id, (events.get(e.company_id) ?? 0) + 1);
  }

  interface Agg {
    meetings: number;
    internal_activity: number;
    customer_facing_activity: number;
    inbound_responses: number;
    positive_contact_outcomes: number;
  }
  const agg = new Map<string, Agg>();
  for (const m of input.meetings) {
    if (!m.company_id) continue;
    const a =
      agg.get(m.company_id) ??
      { meetings: 0, internal_activity: 0, customer_facing_activity: 0, inbound_responses: 0, positive_contact_outcomes: 0 };
    a.meetings += 1;
    if (m.direction === 'internal' || m.direction == null) {
      a.internal_activity += 1;
    } else {
      a.customer_facing_activity += 1;
      if (m.direction === 'inbound') a.inbound_responses += 1;
      if (m.outcome === 'positive') a.positive_contact_outcomes += 1;
    }
    agg.set(m.company_id, a);
  }

  const contacts = new Map<string, { named: number; route: number }>();
  for (const c of input.contacts) {
    if (!c.company_id) continue;
    const cur = contacts.get(c.company_id) ?? { named: 0, route: 0 };
    if (c.identity_quality === 'named') cur.named += 1;
    if (c.email || c.phone || c.line || c.instagram || c.whatsapp) cur.route += 1;
    contacts.set(c.company_id, cur);
  }

  return input.companies.map((c) => {
    const a = agg.get(c.id);
    const ct = contacts.get(c.id);
    return {
      company_id: c.id,
      name: c.name,
      status: c.status,
      industry: c.industry,
      tags: c.tags,
      website: c.website,
      won_deals: won.get(c.id) ?? 0,
      order_events: events.get(c.id) ?? 0,
      meetings: a?.meetings ?? 0,
      internal_activity: a?.internal_activity ?? 0,
      customer_facing_activity: a?.customer_facing_activity ?? 0,
      inbound_responses: a?.inbound_responses ?? 0,
      positive_contact_outcomes: a?.positive_contact_outcomes ?? 0,
      contact_named: ct?.named ?? 0,
      contact_any_route: ct?.route ?? 0,
    };
  });
}

/** Run the shared evaluator over live CRM data. Read-only: creates nothing. */
export function buildProspectReview(input: ProspectReviewInput, opts?: { now?: Date }): ProspectFitReport {
  return buildProspectFitReport(buildProspectSourceRows(input), {
    source: 'live CRM via the app (companies, deals, meetings, account_events, contacts)',
    now: opts?.now,
  });
}

/**
 * One filter option: a stable id, the label to show, and the live count.
 * (Named for the pre-migration segment control it replaces; the shape is what
 * the page's filter needs.)
 */
export interface SegmentOption {
  id: string;
  label: string;
  count: number;
}

/**
 * A candidate the model judged as fitting a published archetype, with the
 * display facts the queue row and detail need. `archetype_name` is never null
 * here: no_fit judgments drop out of the queue before this is built.
 */
export interface JudgedCandidate extends ProspectFit {
  judgment: ProspectJudgment;
  archetype_name: string;
}

/** Split a candidate set by session judgment: judged (with names), not yet judged. */
export function splitByJudgment(
  fits: ProspectFit[],
  judgments: Record<string, ProspectJudgment | undefined>
): { judged: JudgedCandidate[]; unjudged: ProspectFit[] } {
  const judged: JudgedCandidate[] = [];
  const unjudged: ProspectFit[] = [];
  for (const f of fits) {
    const j = judgments[f.company_id];
    if (j && j.archetype_id !== 'no_fit') {
      judged.push({ ...f, judgment: j, archetype_name: j.archetype_name ?? j.archetype_id });
    } else if (!j) {
      unjudged.push(f);
    }
    // no_fit judgments are deliberately in neither list: they left the queue.
  }
  return { judged, unjudged };
}

/**
 * The judgment filter's options: one entry per state the queue can actually be
 * in, with live counts. An option nobody is in is not offered, because it would
 * read as "these exist and match nothing" when the truth is "none were found".
 */
export function judgmentOptions(
  fits: ProspectFit[],
  judgments: Record<string, ProspectJudgment | undefined>
): SegmentOption[] {
  const options: SegmentOption[] = [
    { id: 'judged', label: 'Judged', count: 0 },
    { id: 'unjudged', label: 'Not judged yet', count: 0 },
  ];
  for (const f of fits) {
    const j = judgments[f.company_id];
    if (!j) options[1].count += 1;
    else if (j.archetype_id !== 'no_fit') options[0].count += 1;
    // no_fit has left the queue, so it is not an option to filter the queue by.
  }
  return options.filter((o) => o.count > 0);
}

/** Every published archetype, for the filter control. Sourced, never hardcoded. */
export function archetypeOptions(): { id: string; name: string }[] {
  return CAMPAIGN_ARCHETYPES_V1.map((a) => ({ id: a.id, name: a.name }));
}

export interface ProspectFilters {
  query?: string;
  reachability?: string | null;
  /** 'judged' | 'unjudged'; null/absent means no constraint */
  judgment?: string | null;
}

/**
 * Filter candidates. Empty/absent filters mean "no constraint", not "none".
 *
 * `judgments` is passed in rather than stored: the helpers stay pure, and the
 * search haystack can include the archetype the model actually chose (never a
 * keyword guess). The judgment filter offers three states — everything, judged,
 * not yet judged — because that is now the only categorical split the queue
 * has before a human reviews it.
 */
export function filterProspects(
  fits: ProspectFit[],
  filters: ProspectFilters,
  judgments: Record<string, ProspectJudgment | undefined> = {}
): ProspectFit[] {
  const q = (filters.query ?? '').trim().toLowerCase();
  return fits.filter((f) => {
    if (filters.reachability && f.reachability !== filters.reachability) return false;
    const judgment = judgments[f.company_id];
    if (filters.judgment === 'judged' && !judgment) return false;
    if (filters.judgment === 'unjudged' && judgment) return false;
    if (!q) return true;
    const archetypeName = judgment?.archetype_name ?? '';
    const haystack = `${f.name} ${f.industry ?? ''} ${(f.tags ?? []).join(' ')} ${archetypeName}`.toLowerCase();
    return haystack.includes(q);
  });
}

export interface ContactAvailability {
  named: number;
  routeOnly: number;
  none: number;
  total: number;
}

/** Contact availability per company, derived from the contacts table only. */
export function contactAvailability(contacts: ReviewContact[]): Map<string, ContactAvailability> {
  const map = new Map<string, ContactAvailability>();
  for (const c of contacts) {
    if (!c.company_id) continue;
    const cur = map.get(c.company_id) ?? { named: 0, routeOnly: 0, none: 0, total: 0 };
    cur.total += 1;
    const hasRoute = Boolean(c.email || c.phone || c.line || c.instagram || c.whatsapp);
    if (c.identity_quality === 'named') cur.named += 1;
    else if (hasRoute) cur.routeOnly += 1;
    else cur.none += 1;
    map.set(c.company_id, cur);
  }
  return map;
}

export type DimensionState = 'not_assessed' | 'not_started' | 'not_authorised';

export interface ReviewDimension {
  key: string;
  label: string;
  state: DimensionState;
  /** where the state comes from — shown to the reader so nothing looks like app data */
  source: string;
}

/**
 * The three readiness dimensions, kept VISIBLY SEPARATE and all reported as
 * un-assessed here. None of them has an approved structured source in this app, so
 * the screen must not imply otherwise. The local pilot assessed some of these in
 * markdown, which is deliberately NOT promoted into app data.
 */
export const READINESS_DIMENSIONS: ReviewDimension[] = [
  {
    key: 'serviceability',
    label: 'Serviceability',
    state: 'not_assessed',
    source: 'not assessed in this app: delivery coverage and terms are confirmed per account manually',
  },
  {
    key: 'sales_qualification',
    label: 'Sales qualification',
    state: 'not_started',
    source: 'not started: needs contact or CRM-internal knowledge, and is not a discovery gate',
  },
  {
    key: 'outreach_authorisation',
    label: 'Outreach authorisation',
    state: 'not_authorised',
    source: 'not authorised: each account needs explicit approval before any message',
  },
];
