import { describe, expect, it } from 'vitest';
import type { Company, Deal } from '@/types/crm';
import type { LaneTimeline } from './lane-time';
import {
  ACQUISITION_SOURCES,
  acquisitionLabel,
  buildSourceFunnel,
  DEAL_FORM_SOURCE_KEY,
  filterDealsBySource,
  furthestStep,
  normalizeAcquisition,
  sourceByCompany,
  splitDealFormSource,
} from './acquisition-source';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function deal(overrides: Partial<Deal>): Deal {
  return {
    id: crypto.randomUUID(),
    title: 'Butter opportunity',
    stage: 'research',
    product: 'Butter',
    client: 'Example buyer',
    company_id: null,
    contact_ids: [],
    value: null,
    priority: 'medium',
    next_action: null,
    followup_date: null,
    last_outcome: null,
    nudge_count: 0,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function timeline(...lanes: Deal['workflow_action'][]): LaneTimeline {
  return { enteredAt: 0, source: 'moved', stays: lanes.map(lane => ({ lane: lane!, from: null, to: null })) };
}

const companies: Pick<Company, 'id' | 'acquisition_source'>[] = [
  { id: 'meta-co', acquisition_source: 'meta_ad' },
  { id: 'outbound-co', acquisition_source: 'outbound' },
  { id: 'unset-co', acquisition_source: null },
];

describe('acquisition source', () => {
  it('keeps the closed vocabulary in step with the migration check constraint', () => {
    // The newest migration that sets the constraint is the one in force.
    const dir = join(process.cwd(), 'supabase/migrations');
    const file = readdirSync(dir).sort().reverse()
      .find(name => readFileSync(join(dir, name), 'utf8').includes('add constraint companies_acquisition_source_check'));
    expect(file).toBeTruthy();
    const sql = readFileSync(join(dir, file!), 'utf8');
    const allowed = /acquisition_source in \(([^)]*)\)/.exec(sql)?.[1].match(/'([^']+)'/g)?.map(v => v.slice(1, -1));
    expect([...(allowed ?? [])].sort()).toEqual([...ACQUISITION_SOURCES].sort());
  });

  it('writes a blank or unknown source as null and drops a campaign without a source', () => {
    expect(normalizeAcquisition({ acquisition_source: 'meta_ad', acquisition_campaign: '  Croissant Oct ' }))
      .toEqual({ acquisition_source: 'meta_ad', acquisition_campaign: 'Croissant Oct' });
    expect(normalizeAcquisition({ acquisition_source: '', acquisition_campaign: 'stray' }))
      .toEqual({ acquisition_source: null, acquisition_campaign: null });
    expect(normalizeAcquisition({ acquisition_source: 'tiktok', acquisition_campaign: '' }))
      .toEqual({ acquisition_source: null, acquisition_campaign: null });
    expect(normalizeAcquisition({ acquisition_source: 'referral', acquisition_campaign: '   ' }))
      .toEqual({ acquisition_source: 'referral', acquisition_campaign: null });
  });

  it('labels a source with its campaign, and nothing when not recorded', () => {
    expect(acquisitionLabel({ acquisition_source: 'meta_ad', acquisition_campaign: 'Croissant Oct' })).toBe('Meta ad · Croissant Oct');
    expect(acquisitionLabel({ acquisition_source: 'outbound', acquisition_campaign: null })).toBe('Outbound');
    expect(acquisitionLabel({ acquisition_source: null, acquisition_campaign: null })).toBeNull();
  });

  it('filters deals by their company source, with unset covering no company and no source', () => {
    const sources = sourceByCompany(companies);
    const meta = deal({ company_id: 'meta-co' });
    const outbound = deal({ company_id: 'outbound-co' });
    const unset = deal({ company_id: 'unset-co' });
    const orphan = deal({ company_id: null });
    const all = [meta, outbound, unset, orphan];

    expect(filterDealsBySource(all, 'all', sources)).toBe(all);
    expect(filterDealsBySource(all, 'meta_ad', sources)).toEqual([meta]);
    expect(filterDealsBySource(all, 'outbound', sources)).toEqual([outbound]);
    expect(filterDealsBySource(all, 'referral', sources)).toEqual([]);
    expect(filterDealsBySource(all, 'unset', sources)).toEqual([unset, orphan]);
  });
});

describe('source funnel', () => {
  it('reads the furthest step from the current lane and the logged history', () => {
    expect(furthestStep(deal({ workflow_action: 'outreach' }))).toBe('outreach');
    expect(furthestStep(deal({ workflow_action: 'sample' }))).toBe('sample');
    expect(furthestStep(deal({ workflow_action: 'reschedule' }))).toBe('testing');
    expect(furthestStep(deal({ stage: 'closed_won', workflow_action: 'success' }))).toBe('success');
    // Parked after a sample: the log keeps how far it got.
    expect(furthestStep(deal({ workflow_action: 'parked' }), timeline('outreach', 'reply', 'sample', 'parked'))).toBe('sample');
    // Lost with no history: only outreach is known.
    expect(furthestStep(deal({ stage: 'closed_lost', workflow_action: 'parked' }))).toBe('outreach');
  });

  it('counts each deal at every step it reached, plus lost and parked exits', () => {
    const won = deal({ stage: 'closed_won', workflow_action: 'success' });
    const testing = deal({ stage: 'negotiation', workflow_action: 'testing' });
    const replied = deal({ stage: 'contacted', workflow_action: 'reply' });
    const lostAfterSample = deal({ stage: 'closed_lost', workflow_action: 'parked' });
    const parked = deal({ workflow_action: 'parked' });
    const funnel = buildSourceFunnel(
      [won, testing, replied, lostAfterSample, parked],
      new Map([[lostAfterSample.id, timeline('reply', 'sample', 'parked')]]),
    );

    expect(funnel.total).toBe(5);
    expect(funnel.reached).toEqual({ outreach: 5, reply: 4, sample: 3, testing: 2, success: 1 });
    expect(funnel.lost).toBe(1);
    expect(funnel.parked).toBe(1);
  });

  it('is all zeros for a source with no deals', () => {
    expect(buildSourceFunnel([])).toEqual({ total: 0, reached: { outreach: 0, reply: 0, sample: 0, testing: 0, success: 0 }, lost: 0, parked: 0 });
  });
});

describe('new deal form source', () => {
  it('splits a source change off as a company patch', () => {
    const { deal: row, companyPatch } = splitDealFormSource({
      company_id: 'meta-co',
      title: 'Butter — Meta buyer',
      [DEAL_FORM_SOURCE_KEY]: { acquisition_source: 'meta_ad', acquisition_campaign: ' Oct promo ' },
    });
    expect(row).toEqual({ company_id: 'meta-co', title: 'Butter — Meta buyer' });
    expect(companyPatch).toEqual({ id: 'meta-co', acquisition_source: 'meta_ad', acquisition_campaign: 'Oct promo' });
  });

  it('sends no patch without a change or without a company', () => {
    expect(splitDealFormSource({ company_id: 'meta-co', title: 'x' }).companyPatch).toBeNull();
    const noCompany = splitDealFormSource({ company_id: null, [DEAL_FORM_SOURCE_KEY]: { acquisition_source: 'meta_ad' } });
    expect(noCompany.companyPatch).toBeNull();
    expect(noCompany.deal).toEqual({ company_id: null });
  });
});
