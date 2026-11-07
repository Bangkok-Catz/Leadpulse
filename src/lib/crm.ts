// LeadPulse CRM — Supabase Data Layer

import { supabase } from './supabase';
import { Company, Contact, Deal, Meeting } from '@/types/crm';
import { fitFromAnswers, type CompanyFit, type EvidenceRow } from '@/utils/account-profile';
import type { EnrichmentProposal, ProposalStatus } from '@/utils/proposals';
import {
  COMPANY_LOGO_BUCKET,
  PROPOSED_LOGO_DIR,
  companyIdOfLogoFile,
  logoPath,
  proposedLogoPath,
  rejectedLogoPath,
} from '@/utils/logo-paths';
import { pairKey } from '@/utils/company-duplicates';
import { withBuyerReadings, type BuyerReadingRow } from '@/utils/buyer-reading';

// Soft-delete (archive) helpers — recoverable, never a hard DELETE.
export async function softDelete(entity: 'companies' | 'contacts' | 'deals' | 'meetings', id: string) {
  const { error } = await supabase
    .from(entity)
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', id);
  if (error) throw error;
}

export async function restoreEntity(entity: 'companies' | 'contacts' | 'deals' | 'meetings', id: string) {
  const { error } = await supabase
    .from(entity)
    .update({ deleted_at: null } as any)
    .eq('id', id);
  if (error) throw error;
}

// ─── Companies ───
export async function getCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .is('deleted_at', null)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createCompany(company: Omit<Company, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase.from('companies').insert(company).select().single();
  if (error) throw error;
  return data;
}

export async function updateCompany(id: string, updates: Partial<Company>) {
  const payload: any = { ...updates, updated_at: new Date().toISOString() };
  if (payload.last_contact_date === '') payload.last_contact_date = null;
  const { data, error } = await supabase.from('companies').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// ─── Company logo storage (bucket: company-logos; paths in utils/logo-paths) ───
export { COMPANY_LOGO_BUCKET };

/** A public logo URL with a version, so a replaced file (same path) is loaded fresh. */
function versionedLogoUrl(path: string, version: string | number = Date.now()): string {
  const { data } = supabase.storage.from(COMPANY_LOGO_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${encodeURIComponent(String(version))}`;
}

export async function uploadCompanyLogo(companyId: string, file: File): Promise<string> {
  const path = logoPath(companyId);
  const { error } = await supabase.storage
    .from(COMPANY_LOGO_BUCKET)
    .upload(path, file, { upsert: true, contentType: 'image/webp', cacheControl: '3600' });
  if (error) throw error;
  return versionedLogoUrl(path);
}

export async function deleteCompanyLogo(companyId: string): Promise<void> {
  const { error } = await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([logoPath(companyId)]);
  if (error) throw error;
}

/** Logos found on accounts' websites, waiting for Pat: companyId → image URL. */
export async function getLogoProposals(): Promise<Map<string, string>> {
  const { data, error } = await supabase.storage.from(COMPANY_LOGO_BUCKET).list(PROPOSED_LOGO_DIR, { limit: 1000 });
  if (error) throw error;
  const proposals = new Map<string, string>();
  for (const file of data ?? []) {
    const companyId = companyIdOfLogoFile(file.name);
    if (companyId) proposals.set(companyId, versionedLogoUrl(proposedLogoPath(companyId), file.updated_at ?? file.name));
  }
  return proposals;
}

/** Asks the server to look for this account's logo on its website. The URL of what it found, or
 *  null when the site offered nothing usable. */
export async function findLogoOnSite(companyId: string): Promise<string | null> {
  const response = await fetch('/api/logo-proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ companyId }),
  });
  const body = await response.json().catch(() => null) as { status?: string; url?: string; error?: string } | null;
  if (!response.ok) throw new Error(body?.error || 'Could not look for a logo');
  return body?.status === 'proposed' && body.url ? body.url : null;
}

/** Use logo: the found logo becomes the account's logo. */
export async function acceptLogoProposal(companyId: string): Promise<string> {
  const bucket = supabase.storage.from(COMPANY_LOGO_BUCKET);
  // Make sure the found logo is still there before clearing the old one: a second Use logo
  // (a double tap) would otherwise delete the logo the first one just put in place.
  const { error: missing } = await bucket.download(proposedLogoPath(companyId));
  if (missing) throw missing;
  await bucket.remove([logoPath(companyId)]);
  const { error } = await bucket.move(proposedLogoPath(companyId), logoPath(companyId));
  if (error) throw error;
  const url = versionedLogoUrl(logoPath(companyId));
  await updateCompany(companyId, { logo_url: url });
  return url;
}

/** Not theirs: kept aside under logos/rejected/ so the site isn't asked again. */
export async function rejectLogoProposal(companyId: string): Promise<void> {
  const bucket = supabase.storage.from(COMPANY_LOGO_BUCKET);
  await bucket.remove([rejectedLogoPath(companyId)]);
  const { error } = await bucket.move(proposedLogoPath(companyId), rejectedLogoPath(companyId));
  if (error) throw error;
}

// ─── Duplicate accounts (supabase/migrations/20261025120000_company_duplicates.sql) ───

/** Pairs Pat marked "Not a duplicate", as pairKey() keys. */
export async function getDuplicateDismissals(): Promise<Set<string>> {
  const { data, error } = await supabase.from('company_duplicate_dismissals').select('company_a, company_b');
  if (error) throw error;
  return new Set(((data ?? []) as { company_a: string; company_b: string }[]).map((row) => pairKey(row.company_a, row.company_b)));
}

const orderedPair = (x: string, y: string) => (x < y ? { company_a: x, company_b: y } : { company_a: y, company_b: x });

export async function dismissDuplicate(x: string, y: string): Promise<void> {
  const { error } = await supabase.from('company_duplicate_dismissals').upsert(orderedPair(x, y), { onConflict: 'company_a,company_b', ignoreDuplicates: true });
  if (error) throw error;
}

export async function undismissDuplicate(x: string, y: string): Promise<void> {
  const { company_a, company_b } = orderedPair(x, y);
  const { error } = await supabase.from('company_duplicate_dismissals').delete().eq('company_a', company_a).eq('company_b', company_b);
  if (error) throw error;
}

export interface MergeResult {
  merge_id: string;
  /** rows moved onto the kept account, per table */
  moved: Record<string, number>;
  /** the kept account's fields filled from the other */
  filled: string[];
}

/** Moves everything from `mergeId` onto `keepId`, fills its empty fields, and archives `mergeId`. */
export async function mergeCompanies(keepId: string, mergeId: string): Promise<MergeResult> {
  const { data, error } = await supabase.rpc('merge_companies', { keep_id: keepId, merge_id: mergeId });
  if (error) throw error;
  return data as MergeResult;
}

/** Undoes a merge: rows moved back, filled fields cleared, the merged account restored. */
export async function unmergeCompanies(mergeId: string): Promise<void> {
  const { error } = await supabase.rpc('unmerge_companies', { merge_log_id: mergeId });
  if (error) throw error;
}

// ─── Contacts ───
export async function getContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .is('deleted_at', null)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createContact(contact: Omit<Contact, 'id' | 'created_at' | 'updated_at'>) {
  const payload: any = { ...contact };
  // Blank UUID/date fields must be null, never empty strings (22P02 otherwise).
  if (payload.company_id === '') payload.company_id = null;
  const { data, error } = await supabase.from('contacts').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateContact(id: string, updates: Partial<Contact>) {
  const payload: any = { ...updates, updated_at: new Date().toISOString() };
  // Convert empty strings to null for UUID fields
  if (payload.company_id === '') payload.company_id = null;
  const { data, error } = await supabase
    .from('contacts')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Deals ───
export async function getDeals(): Promise<Deal[]> {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// The value column is NUMERIC — empty or non-numeric strings must become null, never ''.
function normalizeDealValue(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function createDeal(deal: Omit<Deal, 'id' | 'created_at' | 'updated_at'>) {
  const payload: any = { ...deal };
  if (payload.company_id === '') payload.company_id = null;
  if (payload.followup_date === '') payload.followup_date = null;
  if (payload.nudge_stage === '') payload.nudge_stage = null;
  if (payload.sample_status === '') payload.sample_status = null;
  if (typeof payload.draft_primary_ask === 'string' && !payload.draft_primary_ask.trim()) payload.draft_primary_ask = null;
  payload.value = normalizeDealValue(payload.value);
  const { data, error } = await supabase.from('deals').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateDealStage(id: string, stage: Deal['stage']) {
  const { data, error } = await supabase.from('deals').update({ stage, updated_at: new Date() }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

function normalizeDealUpdate(updates: Partial<Deal>) {
  const payload: any = { ...updates, updated_at: new Date().toISOString() };
  // Convert empty date and workflow option strings to null
  if (payload.followup_date === '') payload.followup_date = null;
  if (payload.nudge_stage === '') payload.nudge_stage = null;
  if (payload.sample_status === '') payload.sample_status = null;
  if (typeof payload.draft_primary_ask === 'string' && !payload.draft_primary_ask.trim()) payload.draft_primary_ask = null;
  // Only touch value when the caller sent it — undo snapshots may omit the key.
  if ('value' in payload) payload.value = normalizeDealValue(payload.value);
  return payload;
}

export async function updateDeal(id: string, updates: Partial<Deal>) {
  const payload = normalizeDealUpdate(updates);
  const { data, error } = await supabase
    .from('deals')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Applies an interaction-driven transition only if the deal is still the row
 * the user reviewed. A lost response is safe to retry: if the requested fields
 * already match, the current row is returned instead of writing again.
 */
export async function updateDealIfUnchanged(id: string, expectedUpdatedAt: string, updates: Partial<Deal>) {
  const payload = normalizeDealUpdate(updates);
  const { data, error } = await supabase
    .from('deals')
    .update(payload)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: current, error: currentError } = await supabase
    .from('deals')
    .select('*')
    .eq('id', id)
    .single();
  if (currentError) throw currentError;

  const requestedEntries = Object.entries(payload).filter(([key]) => key !== 'updated_at');
  const currentRecord = current as Record<string, unknown>;
  const alreadyApplied = requestedEntries.every(([key, value]) => Object.is(currentRecord[key], value));
  if (alreadyApplied) return current;

  throw new Error('This deal changed while the interaction was saving. Review its current lane before trying again.');
}

export interface CloseDealOrder {
  companyId: string;
  eventDate: string;
  amount: number;
  productLine: string | null;
}

export class OrderRecordPendingError extends Error {
  constructor(
    public readonly deal: Deal,
    public readonly order: CloseDealOrder,
    cause: unknown,
  ) {
    super('The deal was marked won, but its order record was not saved. Retry the order record.');
    this.name = 'OrderRecordPendingError';
    this.cause = cause;
  }
}

/**
 * Stores an explicit closed-won order once. A retry first checks the stable
 * deal-specific order id, so a lost response cannot manufacture another order.
 */
export async function recordOrderForClosedDeal(dealId: string, order: CloseDealOrder) {
  const orderId = `deal_${dealId}`;
  const { data: existing, error: existingError } = await supabase
    .from('account_events')
    .select('company_id,event_date,amount,product_line,order_id,source')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  return createAccountEvent({
    company_id: order.companyId,
    event_date: order.eventDate,
    amount: order.amount,
    product_line: order.productLine,
    order_id: orderId,
  });
}

/**
 * Closes only the version the user reviewed. When a confirmed positive order
 * cannot be recorded afterwards, the caller gets a retryable error instead of
 * falsely presenting the sale signal as saved.
 */
export async function closeDealWithOrderIfUnchanged(input: {
  dealId: string;
  expectedUpdatedAt: string;
  updates: Partial<Deal>;
  order: CloseDealOrder | null;
}): Promise<Deal> {
  const updatedDeal = await updateDealIfUnchanged(input.dealId, input.expectedUpdatedAt, input.updates);
  if (!input.order) return updatedDeal as Deal;

  try {
    await recordOrderForClosedDeal(input.dealId, input.order);
    return updatedDeal as Deal;
  } catch (cause) {
    throw new OrderRecordPendingError(updatedDeal as Deal, input.order, cause);
  }
}

// ─── Meetings ───
export async function getMeetings(): Promise<Meeting[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .is('deleted_at', null)
    .order('date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createMeeting(meeting: Omit<Meeting, 'id' | 'created_at'>) {
  const payload: any = { ...meeting };
  // Blank UUID/date fields must be null, never empty strings.
  if (payload.company_id === '') payload.company_id = null;
  if (payload.deal_id === '') payload.deal_id = null;
  if (payload.followup_date === '') payload.followup_date = null;
  const { data, error } = await supabase.from('meetings').insert(payload).select().single();
  if (error) throw error;
  return data;
}

// ─── Stats ───
export async function getStats() {
  const [contacts, companies, deals, meetings] = await Promise.all([
    getContacts(),
    getCompanies(),
    getDeals(),
    getMeetings(),
  ]);

  return {
    totalContacts: contacts.length,
    totalCompanies: companies.length,
    totalDeals: deals.length,
    totalMeetings: meetings.length,
    activeDeals: deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage)).length,
    wonDeals: deals.filter(d => d.stage === 'closed_won').length,
    lostDeals: deals.filter(d => d.stage === 'closed_lost').length,
  };
}

// ─── Activity Events (durable audit trail) ───
export interface ActivityEvent {
  id: string;
  type: string;
  entity: string;
  entity_id: string | null;
  label: string;
  description: string | null;
  undo_payload: Record<string, any> | null;
  applied: boolean;
  timestamp: string;
  created_at: string;
}

export async function getActivityEvents(): Promise<ActivityEvent[]> {
  const { data, error } = await supabase
    .from('activity_events')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data || [];
}

export async function createActivityEvent(event: {
  type: string;
  entity: string;
  entity_id?: string | null;
  label: string;
  description?: string | null;
  undo_payload?: Record<string, any> | null;
}) {
  const { data, error } = await supabase
    .from('activity_events')
    .insert({
      ...event,
      applied: true,
      timestamp: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateActivityEvent(id: string, patch: Partial<ActivityEvent>) {
  const { data, error } = await supabase
    .from('activity_events')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Account Events (per-company sales history → retention scoring) ───
// Feeds the Monetary (M) sub-score, reorder cadence (F) and true last-order
// recency (R). Read-only in the app: rows arrive via CSV/backfill imports.
export interface AccountEvent {
  company_id: string;
  event_date: string; // 'YYYY-MM-DD'
  amount: number;
  product_line: string | null;
  order_id: string | null;
  /** Origin in account_events; optional for legacy fixtures, required by the persisted table. */
  source?: string | null;
}

export async function getAccountEvents(): Promise<AccountEvent[]> {
  const { data, error } = await supabase
    .from('account_events')
    .select('company_id,event_date,amount,product_line,order_id,source')
    .order('event_date', { ascending: true });
  if (error) throw error;
  return (data || []) as AccountEvent[];
}

// App-recorded order. Two origins: 'app_closed_won' (Success lane move) and
// 'app_manual' ("Log sale" on a company). Both feed unified_sales →
// reorder_signals so every sale typed advances that buyer's cycle instantly.
// source='backfill-from-sales%' rows are import copies — excluded from the
// unified view, so there is no double-count path.
export async function createAccountEvent(event: AccountEvent, source: string = 'app_closed_won') {
  const payload: any = {
    ...event,
    amount: event.amount > 0 ? event.amount : 0, // zero = flagged, excluded from cycle math
    source,
  };
  if (payload.company_id === '' || payload.company_id == null) return null; // no company link → nothing to attribute
  const { data, error } = await supabase
    .from('account_events')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Laya judgments (read-only; only the Mac worker writes) ───
export interface LayaJudgmentRow {
  deal_id: string;
  question_set: string;
  input_sha256: string;
  status: 'scored' | 'not_scored';
  not_scored_code: string | null;
  answers: Record<string, { probabilities?: Record<string, number>; noul?: number }> | null;
  model_package_sha256: string;
  scored_at: string;
  /** the state that was scored; how a Laya row is matched with LFM3's reading of the same reply */
  scored_state?: string;
  /** whose buyer_response the row carries: LFM3's model repository, or null for Laya's own */
  buyer_reader?: string | null;
}

const JUDGMENT_COLUMNS = 'deal_id, question_set, input_sha256, status, not_scored_code, answers, model_package_sha256, scored_at, scored_state';
const BUYER_READING_COLUMNS = 'deal_id, scored_state, status, answers, model_repository, scored_at';

/**
 * LFM3's saved readings of buyer replies ("buyer" set), from the latest view or the full
 * history. A failed read returns none: the grade then simply uses Laya's own reading.
 */
async function getBuyerReadings(opts: { latest: boolean; dealId?: string }): Promise<BuyerReadingRow[]> {
  try {
    let query = supabase
      .from(opts.latest ? 'laya_judgments_latest' : 'laya_judgments')
      .select(BUYER_READING_COLUMNS)
      .eq('question_set', 'buyer')
      .eq('status', 'scored')
      .not('deal_id', 'is', null);
    if (opts.dealId) query = query.eq('deal_id', opts.dealId);
    const { data, error } = await query.order('scored_at', { ascending: false }).limit(opts.dealId ? 20 : 1000);
    if (error) return [];
    return (data as BuyerReadingRow[] | null) ?? [];
  } catch {
    return [];
  }
}

/** The newest deal-set judgment for one deal, or null when none has been saved. */
export async function getLatestDealJudgment(dealId: string): Promise<LayaJudgmentRow | null> {
  const [{ data, error }, readings] = await Promise.all([
    supabase
      .from('laya_judgments_latest')
      .select(JUDGMENT_COLUMNS)
      .eq('deal_id', dealId)
      .eq('question_set', 'terminal')
      .maybeSingle(),
    getBuyerReadings({ latest: true, dealId }),
  ]);
  if (error) throw error;
  const row = (data as LayaJudgmentRow | null) ?? null;
  return row ? withBuyerReadings([row], readings)[0] : null;
}

// ─── Review decisions (Pat's confirm/reject on a deal Laya routed to review) ───
export interface ReviewDecisionRow {
  deal_id: string;
  input_sha256: string | null;
  decision: 'confirm' | 'reject';
  base_tier: string;
  suggested_tier: string | null;
  momentum: number | null;
  review_reasons: string[];
  decided_at: string;
}

/** Decisions newest first — every deal, or one. Append-only: the newest per reply stands. */
export async function getReviewDecisions(dealId?: string): Promise<ReviewDecisionRow[]> {
  let query = supabase
    .from('laya_review_decisions')
    .select('deal_id, input_sha256, decision, base_tier, suggested_tier, momentum, review_reasons, decided_at');
  if (dealId) query = query.eq('deal_id', dealId);
  const { data, error } = await query.order('decided_at', { ascending: false }).limit(dealId ? 20 : 1000);
  if (error) throw error;
  return (data as ReviewDecisionRow[] | null) ?? [];
}

export async function addReviewDecision(row: Omit<ReviewDecisionRow, 'decided_at'>): Promise<ReviewDecisionRow> {
  const { data, error } = await supabase
    .from('laya_review_decisions')
    .insert(row)
    .select('deal_id, input_sha256, decision, base_tier, suggested_tier, momentum, review_reasons, decided_at')
    .single();
  if (error) throw error;
  return data as ReviewDecisionRow;
}

// ─── Sales goals (one revenue goal per month) ───
/** The goal for the month starting on `month` (YYYY-MM-01), or null when none is set. */
export async function getSalesGoal(month: string): Promise<number | null> {
  const { data, error } = await supabase.from('sales_goals').select('amount').eq('month', month).maybeSingle();
  if (error) throw error;
  return data ? Number(data.amount) : null;
}

export async function setSalesGoal(month: string, amount: number): Promise<void> {
  const { error } = await supabase
    .from('sales_goals')
    .upsert({ month, amount, updated_at: new Date().toISOString() }, { onConflict: 'month' });
  if (error) throw error;
}

/**
 * Scored deal-set judgments, newest first — every deal, or one. The append-only table
 * keeps a row per reply, which is what the trend against the previous reply reads.
 */
export async function getDealJudgmentHistory(dealId?: string): Promise<LayaJudgmentRow[]> {
  let query = supabase
    .from('laya_judgments')
    .select(JUDGMENT_COLUMNS)
    .eq('question_set', 'terminal')
    .eq('status', 'scored')
    .not('deal_id', 'is', null);
  if (dealId) query = query.eq('deal_id', dealId);
  const [{ data, error }, readings] = await Promise.all([
    query.order('scored_at', { ascending: false }).limit(dealId ? 20 : 1000),
    getBuyerReadings({ latest: false, dealId }),
  ]);
  if (error) throw error;
  return withBuyerReadings((data as LayaJudgmentRow[] | null) ?? [], readings);
}

/** The newest deal-set judgment for every deal that has one. */
export async function getLatestDealJudgments(): Promise<LayaJudgmentRow[]> {
  const [{ data, error }, readings] = await Promise.all([
    supabase
      .from('laya_judgments_latest')
      .select(JUDGMENT_COLUMNS)
      .eq('question_set', 'terminal')
      .not('deal_id', 'is', null),
    getBuyerReadings({ latest: true }),
  ]);
  if (error) throw error;
  return withBuyerReadings((data as LayaJudgmentRow[] | null) ?? [], readings);
}

// ─── Account profile: Laya's fit grade, sources, and proposals waiting for Pat ───

/** Laya's latest fit grade per prospect (saved by the Mac worker), keyed by company id. */
export async function getCompanyFits(): Promise<Map<string, CompanyFit>> {
  const { data, error } = await supabase
    .from('laya_judgments_latest')
    .select('company_id, status, answers, scored_at')
    .eq('question_set', 'fit')
    .eq('status', 'scored');
  if (error) throw error;
  const fits = new Map<string, CompanyFit>();
  for (const row of (data ?? []) as Array<{ company_id: string | null; answers: Record<string, { noul?: unknown }> | null; scored_at: string }>) {
    const fit = row.company_id ? fitFromAnswers(row.answers, row.scored_at) : null;
    if (row.company_id && fit) fits.set(row.company_id, fit);
  }
  return fits;
}

/** Laya's latest fit grade for one account, or null when it has none. */
export async function getCompanyFit(companyId: string): Promise<CompanyFit | null> {
  const { data, error } = await supabase
    .from('laya_judgments_latest')
    .select('answers, scored_at, status')
    .eq('question_set', 'fit')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { answers: Record<string, { noul?: unknown }> | null; scored_at: string; status: string } | null;
  return row?.status === 'scored' ? fitFromAnswers(row.answers, row.scored_at) : null;
}

/** Where this account's and its contacts' saved values came from (applied sources only). */
export async function getCompanyEvidence(companyId: string): Promise<EvidenceRow[]> {
  const { data, error } = await supabase
    .from('enrichment_evidence')
    .select('entity_type, entity_id, field, value, source_url, source_tier, quote, recorded_at')
    .eq('company_id', companyId)
    .eq('outcome', 'applied');
  if (error) throw error;
  return (data ?? []) as EvidenceRow[];
}

/** Proposals still waiting for Pat: one account's, or every account's (for the list chips). */
export async function getPendingProposals(companyId?: string): Promise<EnrichmentProposal[]> {
  let query = supabase.from('enrichment_proposals').select('*').eq('status', 'pending').order('proposed_at', { ascending: true });
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as EnrichmentProposal[];
}

/** Save or reject a proposal from LeadPulse; the same rules as the Telegram buttons. */
export async function decideProposalInApp(id: string, action: 'save' | 'reject'): Promise<{ status: ProposalStatus; note: string | null; retry: boolean }> {
  const response = await fetch(`/api/proposals/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const body = await response.json().catch(() => null) as { status?: ProposalStatus; note?: string | null; retry?: boolean; error?: string } | null;
  // A 503 carries status 'pending' and retry: the tap can be tried again.
  if (!body?.status) throw new Error(body?.error || `Could not ${action === 'save' ? 'save' : 'record'} (${response.status})`);
  return { status: body.status, note: body.note ?? null, retry: Boolean(body.retry) };
}
