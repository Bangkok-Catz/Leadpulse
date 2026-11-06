// Sending enrichment proposals to Telegram and acting on Pat's tap. Server only.
// A Save writes exactly one allowlisted field, only if it still holds what the proposal saw,
// reads it back, and records the source in enrichment_evidence. Nothing else is written.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { answerTelegramCallback, editTelegramMessage, sendTelegramMessage, type InlineButton } from '@/lib/telegram';
import {
  PROPOSAL_FIELDS,
  PROPOSALS_PER_SEND,
  isCompanyField,
  decisionText,
  newLeadDeal,
  parseProposalCallback,
  proposalButtons,
  proposalMessage,
  stillAsProposed,
  type EnrichmentProposal,
  type ProposalAction,
  type ProposalStatus,
  type RejectReason,
} from '@/utils/proposals';
import { businessDateKey } from '@/utils/business-time';
import { sameBusiness } from '@/utils/lead-apply';

export { sameBusiness };

export interface TelegramOps {
  send: (html: string, buttons?: InlineButton[][]) => Promise<number>;
  edit: (messageId: number, html: string) => Promise<void>;
  answer: (callbackId: string, text: string) => Promise<void>;
}

const telegram: TelegramOps = { send: sendTelegramMessage, edit: editTelegramMessage, answer: answerTelegramCallback };

/** The moment a decision is made; tests pin it. */
let today = () => new Date();
export function setClockForTests(clock: () => Date) { today = clock; }

/** The account a proposal is about; a new lead is named by the proposal itself. */
async function companyName(db: SupabaseClient, proposal: EnrichmentProposal): Promise<string> {
  if (!proposal.company_id) return proposal.value;
  const { data } = await db.from('companies').select('name').eq('id', proposal.company_id).maybeSingle();
  return (data?.name as string | undefined) || 'this account';
}

/** Pending proposals not yet sent, oldest first, at most PROPOSALS_PER_SEND. */
export async function pendingUnsent(db: SupabaseClient = supabase): Promise<EnrichmentProposal[]> {
  const { data, error } = await db
    .from('enrichment_proposals')
    .select('*')
    .eq('status', 'pending')
    .is('sent_at', null)
    .order('proposed_at', { ascending: true })
    .limit(PROPOSALS_PER_SEND);
  if (error) throw new Error(`Could not read proposals: ${error.message}`);
  return (data ?? []) as EnrichmentProposal[];
}

/** Sends each unsent proposal with Save / Not theirs buttons and records the message id. */
export async function sendPendingProposals(db: SupabaseClient = supabase, tg: TelegramOps = telegram): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const proposal of await pendingUnsent(db)) {
    try {
      const name = await companyName(db, proposal);
      const messageId = await tg.send(proposalMessage(proposal, name), proposalButtons(proposal.id, proposal.field, proposal.details));
      const { error } = await db.from('enrichment_proposals')
        .update({ telegram_message_id: messageId, sent_at: new Date().toISOString() })
        .eq('id', proposal.id).eq('status', 'pending');
      if (error) throw new Error(error.message);
      sent += 1;
    } catch {
      failed += 1; // left unsent; the next cron run tries again
    }
  }
  return { sent, failed };
}

async function settle(
  db: SupabaseClient, id: string, status: ProposalStatus, note: string | null, reason: RejectReason | null = null,
): Promise<boolean> {
  const { data, error } = await db.from('enrichment_proposals')
    .update({ status, decision_note: note, decided_at: new Date().toISOString(), ...(reason ? { reject_reason: reason } : {}) })
    .eq('id', id).eq('status', 'pending')
    .select('id');
  return !error && (data?.length ?? 0) === 1;
}

type Decision = {
  status: ProposalStatus; note: string | null; proposal: EnrichmentProposal | null; retry?: boolean; reason?: RejectReason | null;
  /** a new lead's first follow-up date, when its Research deal was created */
  followup?: string | null;
};

const domainOf = (url: string | null | undefined): string | null => {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch {
    return null;
  }
};

/** "Same as <account>": the new lead is an account Pat already has. Its name (and website
 *  domain) become aliases of that account, so Hermes recognises it next time. */
async function linkToExisting(db: SupabaseClient, proposal: EnrichmentProposal): Promise<Decision> {
  const same = proposal.details?.maybe_same;
  if (proposal.field !== 'new_company' || !same?.id) {
    return { status: 'pending', note: 'no account to link to', proposal, retry: true };
  }
  const { data: account, error } = await db.from('companies').select('id, name').eq('id', same.id).maybeSingle();
  if (error) return { status: 'pending', note: 'could not read the account', proposal, retry: true };
  if (!account) {
    await settle(db, proposal.id, 'stale', 'that account no longer exists');
    return { status: 'stale', note: 'that account no longer exists', proposal };
  }
  const domain = domainOf(proposal.details?.website);
  const aliases = [
    { company_id: same.id, kind: 'name', value: proposal.value.trim(), source: `proposal ${proposal.id}` },
    ...(domain ? [{ company_id: same.id, kind: 'domain', value: domain, source: `proposal ${proposal.id}` }] : []),
  ];
  // Already-known aliases conflict on the unique index; that is fine, the link exists.
  await db.from('company_aliases').insert(aliases);
  const note = `same as ${(account as { name: string }).name}`;
  const ok = await settle(db, proposal.id, 'rejected', note, 'customer');
  return ok ? { status: 'rejected', note, proposal, reason: 'customer' } : { status: 'pending', note: 'could not record', proposal, retry: true };
}

function evidenceRow(
  proposal: EnrichmentProposal,
  entity: { type: 'company' | 'contact'; id: string; companyId: string },
  field: string,
  value: string,
) {
  return {
    entity_type: entity.type, entity_id: entity.id, company_id: entity.companyId,
    field, value, source_url: proposal.source_url, source_tier: proposal.source_tier,
    quote: proposal.quote, quote_check: 'passed', outcome: 'applied', method: 'telegram approval',
    fetched_at: proposal.proposed_at,
    run_ref: proposal.run_ref ? `${proposal.run_ref}; approved ${proposal.id}` : `approved ${proposal.id}`,
  };
}

/** website / what_they_make / address: fill the company field only while it still holds what
 *  the proposal saw, so nothing Pat typed is ever overwritten. */
async function saveCompanyField(db: SupabaseClient, proposal: EnrichmentProposal & { entity_id: string }): Promise<Decision> {
  if (!isCompanyField(proposal.field)) throw new Error('not a company field');
  const target = PROPOSAL_FIELDS[proposal.field];
  const id = proposal.id;
  const { data: live, error: readError } = await db.from(target.table).select(`id, ${target.column}`).eq('id', proposal.entity_id).maybeSingle();
  if (readError) return { status: 'pending', note: 'could not read the account', proposal, retry: true };
  const liveValue = (live as Record<string, string | null> | null)?.[target.column] ?? null;
  if (!live || !stillAsProposed(proposal, liveValue)) {
    const note = !live ? 'the account no longer exists' : `${target.label.toLowerCase()} is now ${liveValue || 'empty'}`;
    await settle(db, id, 'stale', note);
    return { status: 'stale', note, proposal };
  }

  // Conditional write: only while the field still holds what the proposal saw.
  let update = db.from(target.table).update({ [target.column]: proposal.value }).eq('id', proposal.entity_id);
  update = proposal.current_value
    ? update.eq(target.column, proposal.current_value)
    : update.or(`${target.column}.is.null,${target.column}.eq.`);
  const { data: written, error: writeError } = await update.select(`id, ${target.column}`);
  if (writeError) return { status: 'pending', note: 'could not save', proposal, retry: true };
  if ((written?.length ?? 0) !== 1) {
    await settle(db, id, 'stale', 'the field changed while saving');
    return { status: 'stale', note: 'the field changed while saving', proposal };
  }
  const { data: back } = await db.from(target.table).select(target.column).eq('id', proposal.entity_id).maybeSingle();
  if ((back as Record<string, string | null> | null)?.[target.column] !== proposal.value) {
    await settle(db, id, 'failed', 'saved value did not read back');
    return { status: 'failed', note: 'saved value did not read back', proposal };
  }
  await db.from('enrichment_evidence').insert(
    evidenceRow(proposal, { type: 'company', id: proposal.entity_id, companyId: proposal.entity_id }, proposal.field, proposal.value),
  );
  await settle(db, id, 'applied', null);
  return { status: 'applied', note: null, proposal };
}

const sameName = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/** decision_maker: create ONE new named, uncontacted contact. Never edits an existing contact
 *  and never sets companies.decision_maker_contact_id (that stays Pat's call). */
async function saveNewContact(db: SupabaseClient, proposal: EnrichmentProposal & { company_id: string }): Promise<Decision> {
  const id = proposal.id;
  const role = proposal.details?.job_title?.trim();
  if (!role) {
    await settle(db, id, 'failed', 'no role on the proposal');
    return { status: 'failed', note: 'no role on the proposal', proposal };
  }
  const { data: company, error: companyError } = await db.from('companies').select('id').eq('id', proposal.company_id).maybeSingle();
  if (companyError) return { status: 'pending', note: 'could not read the account', proposal, retry: true };
  if (!company) {
    await settle(db, id, 'stale', 'the account no longer exists');
    return { status: 'stale', note: 'the account no longer exists', proposal };
  }
  const { data: existing, error: contactsError } = await db.from('contacts').select('id, name').eq('company_id', proposal.company_id).is('deleted_at', null);
  if (contactsError) return { status: 'pending', note: 'could not read contacts', proposal, retry: true };
  const already = (existing as Array<{ id: string; name: string | null }> | null)?.find(c => sameName(c.name, proposal.value));
  if (already) {
    await settle(db, id, 'stale', 'already a contact in LeadPulse');
    return { status: 'stale', note: 'already a contact in LeadPulse', proposal };
  }

  const date = proposal.proposed_at.slice(0, 10);
  const contact = {
    company_id: proposal.company_id,
    name: proposal.value.trim(),
    job_title: role,
    identity_quality: 'named',
    status: 'uncontacted',
    notes: `Owner / decision maker per ${proposal.source_url} (found ${date}); approved on Telegram.`,
  };
  const { data: created, error: insertError } = await db.from('contacts').insert(contact).select('id');
  if (insertError) return { status: 'pending', note: 'could not save', proposal, retry: true };
  const newId = (created as Array<{ id: string }> | null)?.[0]?.id;
  const { data: back } = newId
    ? await db.from('contacts').select('id, name, job_title, status, company_id').eq('id', newId).maybeSingle()
    : { data: null };
  const row = back as { name?: string; job_title?: string; status?: string; company_id?: string } | null;
  if (!newId || !row || row.name !== contact.name || row.job_title !== role || row.status !== 'uncontacted' || row.company_id !== proposal.company_id) {
    await settle(db, id, 'failed', `contact ${newId ?? '(no id)'} did not read back as saved; review it`);
    return { status: 'failed', note: 'saved contact did not read back; review it in LeadPulse', proposal };
  }
  const where = { type: 'contact' as const, id: newId, companyId: proposal.company_id };
  await db.from('enrichment_evidence').insert([
    evidenceRow(proposal, where, 'name', contact.name),
    evidenceRow(proposal, where, 'job_title', role),
  ]);
  await settle(db, id, 'applied', `contact ${newId}`);
  return { status: 'applied', note: `contact ${newId}`, proposal };
}

/** new_company: create ONE prospect company from a business a guide named and Laya judged a fit.
 *  No deal, no contact; "what they make" stays empty because a guide is not their own words. */
async function saveNewCompany(db: SupabaseClient, proposal: EnrichmentProposal): Promise<Decision> {
  const id = proposal.id;
  const d = proposal.details ?? {};
  const industry = d.industry?.trim();
  if (!industry) {
    await settle(db, id, 'failed', 'no industry on the proposal');
    return { status: 'failed', note: 'no industry on the proposal', proposal };
  }
  const { data: companies, error: readError } = await db.from('companies').select('id, name').is('deleted_at', null);
  if (readError) return { status: 'pending', note: 'could not read accounts', proposal, retry: true };
  const already = (companies as Array<{ id: string; name: string | null }> | null)?.find(c => sameBusiness(c.name, proposal.value));
  if (already) {
    await settle(db, id, 'stale', 'already in LeadPulse');
    return { status: 'stale', note: 'already in LeadPulse', proposal };
  }

  const date = proposal.proposed_at.slice(0, 10);
  const fit = typeof d.fit_noul === 'number' ? ` Laya: ${d.archetype ?? 'fit'} ${Math.round(d.fit_noul * 100)}%.` : '';
  const company = {
    name: proposal.value.trim(),
    status: 'prospect',
    industry,
    tags: (d.tags ?? []).map(t => t.trim()).filter(Boolean).slice(0, 8),
    lead_source: 'Hermes discovery',
    account_owner: 'Pat',
    notes: `Found ${date} in ${proposal.source_url}: “${proposal.quote.trim()}”${d.area ? ` Area: ${d.area}.` : ''}`
      + `${d.what_they_make ? ` Guide says: ${d.what_they_make}.` : ''}${d.signal?.trim() ? ` Signal: ${d.signal.trim()}.` : ''}${fit} Approved on Telegram.`,
  };
  const { data: created, error: insertError } = await db.from('companies').insert(company).select('id');
  if (insertError) return { status: 'pending', note: 'could not save', proposal, retry: true };
  const newId = (created as Array<{ id: string }> | null)?.[0]?.id;
  const { data: back } = newId
    ? await db.from('companies').select('id, name, status, industry').eq('id', newId).maybeSingle()
    : { data: null };
  const row = back as { name?: string; status?: string; industry?: string } | null;
  if (!newId || !row || row.name !== company.name || row.status !== 'prospect' || row.industry !== industry) {
    await settle(db, id, 'failed', `company ${newId ?? '(no id)'} did not read back as saved; review it`);
    return { status: 'failed', note: 'saved account did not read back; review it in LeadPulse', proposal };
  }
  await db.from('enrichment_evidence').insert(
    evidenceRow(proposal, { type: 'company', id: newId, companyId: newId }, 'name', company.name),
  );

  // Its first step: a Research deal puts it on This week and in Hermes's owner search. The
  // account is already saved, so a failed deal is reported, not retried as a new account.
  const deal = newLeadDeal(newId, company.name, d.fit_noul, businessDateKey(today()));
  const { data: dealRows, error: dealError } = await db.from('deals').insert(deal).select('id');
  const dealId = (dealRows as Array<{ id: string }> | null)?.[0]?.id;
  const { data: dealBack } = dealId && !dealError
    ? await db.from('deals').select('id, company_id, followup_date').eq('id', dealId).maybeSingle()
    : { data: null };
  const dealOk = (dealBack as { company_id?: string; followup_date?: string } | null)?.company_id === newId
    && (dealBack as { followup_date?: string }).followup_date === deal.followup_date;
  const note = dealOk ? `company ${newId}; deal ${dealId}` : `company ${newId}; no deal yet: add one from Pipeline`;
  await settle(db, id, 'applied', note);
  return { status: 'applied', note, proposal, followup: dealOk ? deal.followup_date : null };
}

/** Applies one decision. Transient failures leave the proposal pending so the tap can be retried. */
export async function decideProposal(
  db: SupabaseClient, id: string, action: ProposalAction, reason: RejectReason | null = null,
): Promise<Decision> {
  const { data: row, error } = await db.from('enrichment_proposals').select('*').eq('id', id).maybeSingle();
  if (error) return { status: 'pending', note: 'could not read the proposal', proposal: null, retry: true };
  if (!row) return { status: 'failed', note: 'proposal not found', proposal: null };
  const proposal = row as EnrichmentProposal;
  if (proposal.status !== 'pending') return { status: proposal.status, note: proposal.decision_note, proposal };

  if (action === 'same') return linkToExisting(db, proposal);
  if (action === 'reject') {
    // Skip reasons belong to new leads; other proposals are a plain "not theirs".
    const why = proposal.field === 'new_company' ? reason : null;
    const ok = await settle(db, id, 'rejected', null, why);
    return ok ? { status: 'rejected', note: null, proposal, reason: why } : { status: 'pending', note: 'could not record', proposal, retry: true };
  }

  const target = (PROPOSAL_FIELDS as Record<string, { kind: string } | undefined>)[proposal.field];
  const subjectOk = target?.kind === 'new_company'
    ? proposal.company_id === null && proposal.entity_id === null
    : proposal.entity_type === 'company' && !!proposal.company_id && proposal.entity_id === proposal.company_id;
  if (!target || !subjectOk) {
    await settle(db, id, 'failed', 'field is not on the allowlist');
    return { status: 'failed', note: 'field is not on the allowlist', proposal };
  }
  if (target.kind === 'new_company') return saveNewCompany(db, proposal);
  const withCompany = proposal as EnrichmentProposal & { company_id: string; entity_id: string };
  return target.kind === 'new_contact' ? saveNewContact(db, withCompany) : saveCompanyField(db, withCompany);
}

/**
 * A decision made in LeadPulse rather than on Telegram. Same rules; afterwards the Telegram
 * message (if one was sent) is edited to say what happened, so the two never disagree.
 */
export async function decideFromApp(
  id: string,
  action: ProposalAction,
  db: SupabaseClient = supabase,
  tg: TelegramOps = telegram,
  reason: RejectReason | null = null,
): Promise<{ status: ProposalStatus; note: string | null; retry: boolean }> {
  const result = await decideProposal(db, id, action, reason);
  const messageId = result.proposal?.telegram_message_id;
  if (!result.retry && result.proposal && messageId) {
    const { footer } = decisionText(result.status, result.note, result.reason, result.followup);
    if (footer) {
      const name = await companyName(db, result.proposal);
      await tg.edit(messageId, `${proposalMessage(result.proposal, name)}\n\n${footer} (in LeadPulse)`).catch(() => undefined);
    }
  }
  return { status: result.status, note: result.note, retry: Boolean(result.retry) };
}

interface CallbackUpdate {
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number };
    message?: { message_id: number; chat?: { id?: number } };
  };
}

/**
 * One Telegram update. Only a button press from the configured chat on a proposal is acted
 * on; everything else is ignored. Returns what happened, for the route's log line.
 */
export async function handleTelegramUpdate(
  update: CallbackUpdate,
  chatId: string,
  db: SupabaseClient = supabase,
  tg: TelegramOps = telegram,
): Promise<string> {
  const query = update.callback_query;
  if (!query) return 'ignored: not a button press';
  if (String(query.message?.chat?.id ?? '') !== chatId) return 'ignored: another chat';
  const parsed = parseProposalCallback(query.data);
  if (!parsed) {
    await tg.answer(query.id, 'Unknown button');
    return 'ignored: unknown button';
  }
  const result = await decideProposal(db, parsed.id, parsed.action, parsed.reason ?? null);
  const { footer, toast } = decisionText(result.status, result.note, result.reason, result.followup);
  if (result.retry) {
    await tg.answer(query.id, `Could not ${parsed.action === 'save' ? 'save' : 'record'} — tap again`);
    return `retry: ${result.note}`;
  }
  await tg.answer(query.id, toast);
  if (result.proposal && query.message?.message_id && footer) {
    const name = await companyName(db, result.proposal);
    await tg.edit(query.message.message_id, `${proposalMessage(result.proposal, name)}\n\n${footer}`).catch(() => undefined);
  }
  return `${parsed.action}: ${result.status}`;
}
