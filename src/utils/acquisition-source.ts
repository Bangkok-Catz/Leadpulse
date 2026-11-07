// ─── How an account was acquired ───
// Pure. The source lives on the company (companies.acquisition_source); a deal reads its
// company's, so the Pipeline filter and the funnel never disagree with the account.
// null = not recorded. Never inferred.

import type { Company, Deal, DealWorkflowAction } from '@/types/crm';
import { getWorkflowAction } from './deal-workflow';
import type { LaneTimeline } from './lane-time';

/** Same values as the companies_acquisition_source_check constraint. */
export const ACQUISITION_SOURCES = ['outbound', 'meta_ad', 'social_post', 'press', 'referral', 'inbound_other'] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export const ACQUISITION_SOURCE_LABELS: Record<AcquisitionSource, string> = {
  outbound: 'Outbound',
  meta_ad: 'Meta ad',
  social_post: 'Social post',
  press: 'Press & TV',
  referral: 'Referral',
  inbound_other: 'Other inbound',
};

export const ACQUISITION_SOURCE_OPTIONS = ACQUISITION_SOURCES.map(value => ({ value, label: ACQUISITION_SOURCE_LABELS[value] }));

export function isAcquisitionSource(value: unknown): value is AcquisitionSource {
  return typeof value === 'string' && (ACQUISITION_SOURCES as readonly string[]).includes(value);
}

/**
 * The two columns as they should be written from a form: an unknown or blank source is
 * null, a blank campaign is null, and a campaign without a source is dropped.
 */
export function normalizeAcquisition(input: { acquisition_source?: unknown; acquisition_campaign?: unknown }): {
  acquisition_source: AcquisitionSource | null;
  acquisition_campaign: string | null;
} {
  const source = isAcquisitionSource(input.acquisition_source) ? input.acquisition_source : null;
  const campaign = typeof input.acquisition_campaign === 'string' ? input.acquisition_campaign.trim() : '';
  return { acquisition_source: source, acquisition_campaign: source && campaign ? campaign : null };
}

/** "Meta ad · Croissant promo Oct", "Referral", or null when not recorded. */
export function acquisitionLabel(company: Pick<Company, 'acquisition_source' | 'acquisition_campaign'> | null | undefined): string | null {
  if (!company || !isAcquisitionSource(company.acquisition_source)) return null;
  const label = ACQUISITION_SOURCE_LABELS[company.acquisition_source];
  return company.acquisition_campaign ? `${label} · ${company.acquisition_campaign}` : label;
}

// ─── Pipeline filter ───

export type SourceFilter = 'all' | AcquisitionSource | 'unset';

export const SOURCE_FILTER_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Any source' },
  { value: 'meta_ad', label: 'Meta ads' },
  { value: 'social_post', label: 'Social posts' },
  { value: 'press', label: 'Press & TV' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'referral', label: 'Referral' },
  { value: 'inbound_other', label: 'Other inbound' },
  { value: 'unset', label: 'Source not set' },
];

/** company id → its recorded source; companies with none are left out. */
export function sourceByCompany(companies: Pick<Company, 'id' | 'acquisition_source'>[]): Map<string, AcquisitionSource> {
  const map = new Map<string, AcquisitionSource>();
  for (const company of companies) {
    if (isAcquisitionSource(company.acquisition_source)) map.set(company.id, company.acquisition_source);
  }
  return map;
}

export function dealSource(deal: Pick<Deal, 'company_id'>, sources: ReadonlyMap<string, AcquisitionSource>): AcquisitionSource | null {
  return deal.company_id ? sources.get(deal.company_id) ?? null : null;
}

export function filterDealsBySource<T extends Pick<Deal, 'company_id'>>(
  deals: T[],
  filter: SourceFilter,
  sources: ReadonlyMap<string, AcquisitionSource>,
): T[] {
  if (filter === 'all') return deals;
  return deals.filter(deal => {
    const source = dealSource(deal, sources);
    return filter === 'unset' ? source === null : source === filter;
  });
}

// ─── How far deals got ───

/** The journey steps the funnel counts, in order. Follow-up comes after a test. */
export const FUNNEL_STEPS = ['outreach', 'reply', 'sample', 'testing', 'success'] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export const FUNNEL_STEP_LABELS: Record<FunnelStep, string> = {
  outreach: 'Outreach',
  reply: 'Reply',
  sample: 'Sample',
  testing: 'Testing',
  success: 'Won',
};

const LANE_DEPTH: Partial<Record<DealWorkflowAction, number>> = {
  outreach: 0,
  reply: 1,
  sample: 2,
  testing: 3,
  reschedule: 3,
  success: 4,
};

/**
 * The furthest journey step a deal reached: its current lane, or any lane the activity
 * log shows it in before. A won deal reached Won. A parked or lost deal with no logged
 * history counts as reaching Outreach only — the log cannot say more.
 */
export function furthestStep(deal: Deal, timeline?: LaneTimeline | null): FunnelStep {
  let depth = deal.stage === 'closed_won' ? LANE_DEPTH.success! : LANE_DEPTH[getWorkflowAction(deal)] ?? 0;
  for (const stay of timeline?.stays ?? []) depth = Math.max(depth, LANE_DEPTH[stay.lane] ?? 0);
  return FUNNEL_STEPS[depth];
}

export interface SourceFunnel {
  /** deals counted */
  total: number;
  /** step → deals that reached that step or further */
  reached: Record<FunnelStep, number>;
  lost: number;
  parked: number;
}

export function buildSourceFunnel(deals: Deal[], timelines?: ReadonlyMap<string, LaneTimeline>): SourceFunnel {
  const reached = Object.fromEntries(FUNNEL_STEPS.map(step => [step, 0])) as Record<FunnelStep, number>;
  let lost = 0;
  let parked = 0;
  for (const deal of deals) {
    const depth = FUNNEL_STEPS.indexOf(furthestStep(deal, timelines?.get(deal.id)));
    for (let i = 0; i <= depth; i++) reached[FUNNEL_STEPS[i]] += 1;
    if (deal.stage === 'closed_lost') lost += 1;
    else if (deal.stage !== 'closed_won' && getWorkflowAction(deal) === 'parked') parked += 1;
  }
  return { total: deals.length, reached, lost, parked };
}

// ─── New deal form ───

/** Key the deal form sends when Pat set or changed the company's source while adding a deal. */
export const DEAL_FORM_SOURCE_KEY = 'company_acquisition';

/**
 * Splits the deal form's company source change from the deal itself. The deal row has no
 * source column; the change is a patch for its company, or null when nothing changed.
 */
export function splitDealFormSource<T extends { company_id?: string | null }>(data: T & { [DEAL_FORM_SOURCE_KEY]?: unknown }): {
  deal: T;
  companyPatch: { id: string; acquisition_source: AcquisitionSource | null; acquisition_campaign: string | null } | null;
} {
  const { [DEAL_FORM_SOURCE_KEY]: change, ...deal } = data;
  if (!change || typeof change !== 'object' || !data.company_id) return { deal: deal as T, companyPatch: null };
  return { deal: deal as T, companyPatch: { id: data.company_id, ...normalizeAcquisition(change as Record<string, unknown>) } };
}
