// ─── Enrichment proposals: what Telegram shows and what a tap may do ───
// Pure. Hermes inserts a proposal only after its source check passed; Pat decides each one
// with a button. Loading, sending and saving live in lib/proposals-data.ts; the buttons
// arrive at app/api/telegram/webhook.

import { FIT_THRESHOLD } from './prospectFit.ts';

export type ProposalField = 'website' | 'decision_maker' | 'what_they_make' | 'address' | 'new_company';
export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'stale' | 'failed';
export type ProposalAction = 'save' | 'reject' | 'same';
/** Why Pat skipped a new lead; Hermes learns from it (lib docs: migration 20261020090000). */
export type RejectReason = 'closed' | 'customer' | 'not_fit';

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  closed: 'Closed',
  customer: 'Customer',
  not_fit: 'Not a fit',
};

/** An existing account Hermes thinks this new lead may be (name looks alike, no exact match). */
export interface MaybeSame {
  id: string;
  name: string;
  status: string;
  why: string;
}

export interface EnrichmentProposal {
  id: string;
  entity_type: 'company' | 'contact';
  /** null only for new_company: the business is not in LeadPulse yet */
  entity_id: string | null;
  company_id: string | null;
  field: ProposalField;
  value: string;
  current_value: string | null;
  source_url: string;
  source_tier: 'own_site' | 'official_social' | 'official_listing' | 'press';
  quote: string;
  /** decision_maker: the role as published, and what to search DBD for.
   *  new_company: what the guide says the business is, and Laya's fit. */
  details?: {
    job_title?: string;
    dbd_keyword?: string;
    industry?: string;
    tags?: string[];
    area?: string;
    what_they_make?: string;
    archetype?: string;
    fit_noul?: number;
    website?: string;
    maybe_same?: MaybeSame | null;
    open_check?: string;
    /** why now, from a buying-signal search: "hiring a pastry chef", "opening a second branch" */
    signal?: string | null;
  } | null;
  reject_reason?: RejectReason | null;
  quote_check: 'passed';
  reason: string | null;
  status: ProposalStatus;
  decision_note: string | null;
  run_ref: string | null;
  proposed_at: string;
  telegram_message_id: number | null;
  sent_at: string | null;
  decided_at: string | null;
}

/** What a tap may write. Widened one field at a time, each reviewed:
 *  - a company field (website, what they make, address) is filled only while it still holds
 *    what the proposal saw, so nothing Pat typed is ever overwritten
 *  - decision_maker creates one new named contact; it never edits an existing one
 *  - new_company creates one prospect company; no deal, no contact */
export const PROPOSAL_FIELDS = {
  website: { kind: 'company_field', table: 'companies', column: 'website', label: 'Website' },
  what_they_make: { kind: 'company_field', table: 'companies', column: 'what_they_make', label: 'What they make' },
  address: { kind: 'company_field', table: 'companies', column: 'address', label: 'Address' },
  decision_maker: { kind: 'new_contact', label: 'Owner / decision maker' },
  new_company: { kind: 'new_company', label: 'New lead' },
} as const satisfies Record<ProposalField, {
  kind: 'company_field' | 'new_contact' | 'new_company'; label: string; table?: 'companies'; column?: string;
}>;

export type CompanyFieldProposal = 'website' | 'what_they_make' | 'address';
export const isCompanyField = (field: ProposalField): field is CompanyFieldProposal =>
  PROPOSAL_FIELDS[field].kind === 'company_field';

const DBD_SEARCH = 'https://datawarehouse.dbd.go.th/juristic/searchInfo?keyword=';

/** DBD's search page with the name or registration number filled in. DBD blocks automated
 *  reads, so this is for Pat to open by hand and check the registered directors. */
export function dbdSearchUrl(keyword: string): string {
  return `${DBD_SEARCH}${encodeURIComponent(keyword.trim())}`;
}

/** How many proposals one cron run sends, so a big research run never floods the chat. */
export const PROPOSALS_PER_SEND = 8;

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const QUOTE_LIMIT = 220;

/** A stored quote as a person reads it. The stored text stays exact (the source check compares
 *  it with the saved page); only the display drops markdown: bullets, headings, bold, and
 *  "[text](url)" link syntax. */
export function displayQuote(quote: string): string {
  return quote
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\n)\s*(?:[-+*•]|#{1,6}|>)\s+/g, '$1')
    .replace(/[*_`]{2,}|`/g, '')
    .replace(/\\([\\_*[\]()#|-])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const TIER_LABEL: Record<EnrichmentProposal['source_tier'], string> = {
  own_site: 'their own site',
  official_social: 'their official social account',
  official_listing: 'an official listing',
  press: 'a press interview, article or guide',
};

/** "gateauxhouse.co.th" from "https://www.gateauxhouse.co.th/". */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/$/, '');
    return `${host}${path}`;
  } catch {
    return url;
  }
}

/** The Telegram message for one proposal (HTML, every value escaped). */
export function proposalMessage(proposal: EnrichmentProposal, companyName: string): string {
  const label = PROPOSAL_FIELDS[proposal.field].label;
  const quote = displayQuote(proposal.quote);
  const shortQuote = quote.length > QUOTE_LIMIT ? `${quote.slice(0, QUOTE_LIMIT - 1)}…` : quote;
  const isPerson = proposal.field === 'decision_maker';
  const isNewLead = proposal.field === 'new_company';
  const d = proposal.details ?? {};
  const role = d.job_title?.trim();
  const dbd = isPerson ? dbdSearchUrl(d.dbd_keyword || companyName) : null;
  const heading = isNewLead
    ? `<b>New lead: ${escapeHtml(proposal.value)}?</b>`
    : `<b>${escapeHtml(label)} for ${escapeHtml(companyName)}?</b>`;
  const valueLine = isPerson
    ? `<b>${escapeHtml(proposal.value)}</b>${role ? ` — ${escapeHtml(role)}` : ''}`
    : isNewLead
      ? [d.industry, d.area].filter(Boolean).map(v => escapeHtml(String(v))).join(' · ')
      : proposal.field === 'website'
        ? `<a href="${escapeHtml(proposal.value)}">${escapeHtml(displayUrl(proposal.value))}</a>`
        : `<b>${escapeHtml(proposal.value)}</b>`;
  const fit = isNewLead && typeof d.fit_noul === 'number'
    ? [`Laya: ${escapeHtml(d.archetype || 'fit')} ${Math.round(d.fit_noul * 100)}%`]
    : [];
  const lines = [
    heading,
    ...(valueLine ? [valueLine] : []),
    ...(isNewLead && d.signal?.trim() ? [`📣 Signal: <b>${escapeHtml(d.signal.trim())}</b>`] : []),
    ...(isNewLead && d.what_they_make ? [`Makes: ${escapeHtml(d.what_they_make)}`] : []),
    ...(isNewLead && d.maybe_same
      ? [`⚠️ Might be <b>${escapeHtml(d.maybe_same.name)}</b> (${escapeHtml(d.maybe_same.status.replace(/_/g, ' '))}): ${escapeHtml(d.maybe_same.why)}`]
      : []),
    ...(isNewLead && d.open_check ? [`Open: ${escapeHtml(d.open_check)}`] : []),
    '',
    `<i>“${escapeHtml(shortQuote)}”</i>`,
    `Source: <a href="${escapeHtml(proposal.source_url)}">${escapeHtml(displayUrl(proposal.source_url))}</a> (${TIER_LABEL[proposal.source_tier]})`,
    ...(proposal.reason ? [escapeHtml(proposal.reason)] : []),
    ...(proposal.current_value ? [`Replaces: ${escapeHtml(proposal.current_value)}`] : []),
    ...(dbd ? [`Check the registered directors: <a href="${escapeHtml(dbd)}">DBD search</a>`] : []),
    ...fit,
    ...(isPerson ? ['Save adds them as a new contact (uncontacted); nothing else changes.'] : []),
    ...(isNewLead ? ['Add creates the account and a Research deal, due on the next owner search.'] : []),
  ];
  return lines.join('\n');
}

const BUTTON_LABELS: Partial<Record<ProposalField, [string, string]>> = {
  new_company: ['✅ Add', '❌ Skip'],
  decision_maker: ['✅ Save', '❌ Not right'],
};

const REASON_CODE: Record<RejectReason, string> = { closed: 'c', customer: 'u', not_fit: 'n' };
const shorten = (name: string, max = 22) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

/**
 * The buttons; labels fit what Save does. A new lead is skipped with a reason (Closed,
 * Customer, Not a fit), and offers "Same as <account>" when Hermes saw a look-alike.
 */
export function proposalButtons(
  proposalId: string,
  field: ProposalField = 'website',
  details?: EnrichmentProposal['details'],
) {
  if (field === 'new_company') {
    const same = details?.maybe_same;
    return [
      [
        { text: '✅ Add', callback_data: `p:${proposalId}:s` },
        ...(same ? [{ text: `🔗 Same as ${shorten(same.name)}`, callback_data: `p:${proposalId}:m` }] : []),
      ],
      (Object.keys(REASON_CODE) as RejectReason[]).map((reason) => ({
        text: REJECT_REASON_LABELS[reason],
        callback_data: `p:${proposalId}:r${REASON_CODE[reason]}`,
      })),
    ];
  }
  const [save, reject] = BUTTON_LABELS[field] ?? ['✅ Save', '❌ Not theirs'];
  return [[
    { text: save, callback_data: `p:${proposalId}:s` },
    { text: reject, callback_data: `p:${proposalId}:r` },
  ]];
}

const CALLBACK = /^p:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(s|m|r[cun]?)$/;
const REASON_BY_CODE: Record<string, RejectReason> = { c: 'closed', u: 'customer', n: 'not_fit' };

/** The proposal, action and skip reason a button carries, or null for anything else. */
export function parseProposalCallback(data: unknown): { id: string; action: ProposalAction; reason?: RejectReason } | null {
  if (typeof data !== 'string') return null;
  const match = CALLBACK.exec(data);
  if (!match) return null;
  const code = match[2];
  if (code === 's') return { id: match[1], action: 'save' };
  if (code === 'm') return { id: match[1], action: 'same' };
  const reason = REASON_BY_CODE[code.slice(1)];
  return reason ? { id: match[1], action: 'reject', reason } : { id: match[1], action: 'reject' };
}

/** A Save may only fill what the proposal saw: the field must still hold current_value. */
export function stillAsProposed(proposal: Pick<EnrichmentProposal, 'current_value'>, liveValue: string | null | undefined): boolean {
  return (liveValue ?? '').trim() === (proposal.current_value ?? '').trim();
}

/** The line added under a decided proposal, and the toast shown on the tap. */
export function decisionText(
  status: ProposalStatus, note?: string | null, reason?: RejectReason | null, followup?: string | null,
): { footer: string; toast: string } {
  switch (status) {
    case 'applied':
      // A new lead: say when it comes back, so Pat knows it isn't lost.
      if (followup) {
        const day = dayLabel(followup);
        return { footer: `✅ <b>Added to LeadPulse.</b> Owner search ${day}, then it's on This week.`, toast: `Added · on This week ${day}` };
      }
      return { footer: '✅ <b>Saved to LeadPulse</b>', toast: 'Saved' };
    case 'rejected':
      if (note?.startsWith('same as ')) return { footer: `🔗 <b>Linked:</b> ${escapeHtml(note)}`, toast: 'Linked to the account' };
      return reason
        ? { footer: `❌ <b>Skipped: ${REJECT_REASON_LABELS[reason].toLowerCase()}</b>`, toast: `Skipped: ${REJECT_REASON_LABELS[reason].toLowerCase()}` }
        : { footer: '❌ <b>Not saved</b>', toast: 'Not saved' };
    case 'stale': return { footer: `⚠️ <b>Not saved:</b> ${escapeHtml(note || 'the field changed since this was proposed')}`, toast: 'Changed since proposed: not saved' };
    case 'failed': return { footer: `⚠️ <b>Could not save:</b> ${escapeHtml(note || 'try again later')}`, toast: 'Could not save' };
    default: return { footer: '', toast: 'Still waiting' };
  }
}

/* ── A new lead's first step ──────────────────────────────────────────────── */

/** Hermes searches for owners on Tuesdays and Thursdays (07:00 Bangkok, cron 5f4badc292f5). */
const OWNER_SEARCH_WEEKDAYS = [2, 4];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utc = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

/** '2026-10-27' → 'Tue 27 Oct'. */
export function dayLabel(key: string): string {
  const d = utc(key);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The next owner-search day after `today` (a lead approved on a search day waits for the next one). */
export function nextOwnerSearch(today: string): string {
  const d = utc(today);
  do d.setUTCDate(d.getUTCDate() + 1); while (!OWNER_SEARCH_WEEKDAYS.includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

export const NEW_LEAD_NEXT_ACTION = 'Find the owner, then send a first message';

/**
 * The Research deal an approved new lead starts with. It puts the lead on This week and in
 * Hermes's owner search (which only looks at accounts with an open deal).
 */
export function newLeadDeal(companyId: string, name: string, fitNoul: number | null | undefined, today: string) {
  return {
    title: `${name} — Butter`,
    client: name,
    company_id: companyId,
    product: 'Butter',
    stage: 'research',
    workflow_action: 'outreach',
    priority: typeof fitNoul === 'number' && fitNoul >= FIT_THRESHOLD ? 'high' : 'medium',
    next_action: NEW_LEAD_NEXT_ACTION,
    followup_date: nextOwnerSearch(today),
    currency: 'THB',
    contact_ids: [] as string[],
  };
}
