// An enquiry from the VG Saveur website's form (POST /api/leads), turned into account rows.
// Pure: reading the form, tagging where it came from, finding the account it belongs to, and
// the rows and Telegram alert it amounts to. Saving lives in lib/website-lead-data.ts.

import type { Company, Contact } from '@/types/crm';
import type { AcquisitionSource } from './acquisition-source';
import { existingAccount, phoneDigits, sameBusiness } from './lead-apply';
import { dayLabel, newLeadDeal } from './proposals';

/** The only fields read from a submission, with their longest accepted length. */
export const LEAD_FIELD_LIMITS = {
  business_name: 120,
  contact_name: 80,
  phone: 30,
  line_id: 60,
  email: 120,
  message: 2000,
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 150,
  utm_content: 150,
  fbclid: 500,
} as const;

export type LeadField = keyof typeof LEAD_FIELD_LIMITS;
export type WebsiteLead = Record<LeadField, string | null>;

/** A field no person sees; a bot that fills it is thanked and ignored. */
export const HONEYPOT_FIELD = 'company_fax';

export type ParsedLead =
  | { ok: true; lead: WebsiteLead }
  | { ok: false; spam: true }
  | { ok: false; spam?: false; error: string; field?: LeadField };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads a submission. Unknown keys are ignored; known ones must be strings within their limit.
 * A business name and one way to reach them (phone, LINE or email) are required.
 */
export function parseWebsiteLead(body: unknown): ParsedLead {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Send the form as JSON' };
  const raw = body as Record<string, unknown>;
  const trap = raw[HONEYPOT_FIELD];
  if (typeof trap === 'string' ? trap.trim() !== '' : trap != null) return { ok: false, spam: true };

  const lead = {} as WebsiteLead;
  for (const field of Object.keys(LEAD_FIELD_LIMITS) as LeadField[]) {
    const value = raw[field];
    if (value == null) { lead[field] = null; continue; }
    if (typeof value !== 'string') return { ok: false, error: `${field} must be text`, field };
    // Control characters never belong in a name or a message; newlines do, in the message.
    const clean = value.replace(field === 'message' ? /[^\P{Cc}\n\t]/gu : /\p{Cc}/gu, ' ').trim();
    if (clean.length > LEAD_FIELD_LIMITS[field]) return { ok: false, error: `${field} is too long`, field };
    lead[field] = clean || null;
  }

  if (!lead.business_name) return { ok: false, error: 'Add the business name', field: 'business_name' };
  if (!lead.phone && !lead.line_id && !lead.email) return { ok: false, error: 'Add a phone number, LINE ID or email', field: 'phone' };
  if (lead.email && !EMAIL.test(lead.email)) return { ok: false, error: 'Check the email address', field: 'email' };
  if (lead.phone && !/^\d{6,15}$/.test(lead.phone.replace(/[\s()+.-]/g, ''))) return { ok: false, error: 'Check the phone number', field: 'phone' };
  return { ok: true, lead };
}

/* ── Where it came from ───────────────────────────────────────────────────── */

/** A whole word inside a utm value: "facebook_ads" holds facebook and ads; "metallica" holds neither. */
const word = (words: string) => new RegExp(`(^|[^a-z])(${words})([^a-z]|$)`);

/** Meta's own channels: a paid click from one of these is a Meta ad. */
const META_SOURCE = word('facebook|instagram|meta|fb|ig');
/** Every channel a post, bio or profile link can come from. */
const SOCIAL_SOURCE = word('facebook|instagram|meta|fb|ig|threads|tiktok|youtube|yt|linkedin|twitter|x|pinterest|bluesky');
/** A paid click: utm_medium "paid", "cpc", "paid_social"…, or a source such as "facebook_ads". */
const PAID = word('paid|paidsocial|cpc|ppc|cpm|cpv|ads?|sponsored|boost|boosted');
/** A link from a post or bio whatever tool shortened it, e.g. utm_source=linktree&utm_medium=social. */
const ORGANIC_MEDIUM = word('social|organic|bio|post|story|reel|profile');

/** Meta's URL parameters arrive unfilled ("{{campaign.name}}") when an ad is set up by hand. */
const filled = (value: string | null) => (value && !/\{\{.*\}\}/.test(value) ? value : null);

/**
 * Where a website enquiry came from, read from its landing URL:
 * - meta_ad: a paid click from Facebook / Instagram (utm_medium=paid as the form guide sets
 *   ads up, or a source like facebook_ads);
 * - social_post: any other click from a social channel, a post or bio link (utm_medium=social),
 *   or an fbclid with no utm values, which Meta adds to unpaid link clicks too;
 * - inbound_other: everything else, paid clicks from other places included.
 * The campaign is utm_campaign, then utm_content when present.
 */
export function websiteAcquisition(lead: Pick<WebsiteLead, 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'fbclid'>): {
  acquisition_source: AcquisitionSource;
  acquisition_campaign: string | null;
} {
  const source = (lead.utm_source ?? '').trim().toLowerCase();
  const medium = (lead.utm_medium ?? '').trim().toLowerCase();
  const fbclidOnly = !source && Boolean(lead.fbclid?.trim());
  const paid = PAID.test(medium) || PAID.test(source);
  const fromMeta = META_SOURCE.test(source) || fbclidOnly;
  const fromSocial = SOCIAL_SOURCE.test(source) || fbclidOnly || ORGANIC_MEDIUM.test(medium);
  const acquisition_source: AcquisitionSource = paid
    ? (fromMeta ? 'meta_ad' : 'inbound_other')
    : fromSocial ? 'social_post' : 'inbound_other';
  const campaign = [filled(lead.utm_campaign), filled(lead.utm_content)].filter(Boolean).join(' · ');
  return { acquisition_source, acquisition_campaign: campaign || null };
}

/* ── The account it belongs to ────────────────────────────────────────────── */

export interface CompanyAlias {
  company_id: string;
  kind: 'name' | 'domain' | 'handle' | 'phone';
  value: string;
}

export type MatchedBy = 'name' | 'alias' | 'phone' | 'email' | 'line';

const handle = (value: string | null | undefined) => (value ?? '').trim().toLowerCase().replace(/^@/, '');

/**
 * The account an enquiry belongs to, so a known business is linked rather than duplicated:
 * the same name (existingAccount, then "Co., Ltd." ignored), a name, phone or handle Pat
 * recorded as an alias, or a contact with the same phone, email or LINE.
 */
export function matchWebsiteLead<T extends Pick<Company, 'id' | 'name' | 'website'>>(
  lead: Pick<WebsiteLead, 'business_name' | 'phone' | 'email' | 'line_id'>,
  known: {
    companies: readonly T[];
    aliases: readonly CompanyAlias[];
    contacts: readonly Pick<Contact, 'company_id' | 'email' | 'phone' | 'phone_second' | 'line'>[];
  },
): { company: T; by: MatchedBy } | null {
  const name = lead.business_name ?? '';
  const byId = (id: string | null | undefined) => known.companies.find(c => c.id === id) ?? null;
  const phone = phoneDigits(lead.phone);
  const line = handle(lead.line_id);
  const email = (lead.email ?? '').trim().toLowerCase();

  const named = existingAccount(known.companies, name, '') ?? known.companies.find(c => sameBusiness(c.name, name));
  if (named) return { company: named, by: 'name' };

  for (const alias of known.aliases) {
    const company = byId(alias.company_id);
    if (!company) continue;
    const hit = (alias.kind === 'name' && sameBusiness(alias.value, name))
      || (alias.kind === 'phone' && phone !== '' && phoneDigits(alias.value) === phone)
      || (alias.kind === 'handle' && line !== '' && handle(alias.value) === line);
    if (hit) return { company, by: 'alias' };
  }

  for (const contact of known.contacts) {
    const company = byId(contact.company_id);
    if (!company) continue;
    if (phone && [contact.phone, contact.phone_second].some(p => p && phoneDigits(p) === phone)) return { company, by: 'phone' };
    if (email && (contact.email ?? '').trim().toLowerCase() === email) return { company, by: 'email' };
    if (line && handle(contact.line) === line) return { company, by: 'line' };
  }
  return null;
}

/** A contact of the account who is the person who wrote, so they are not added twice. */
export function sameContact<T extends Pick<Contact, 'email' | 'phone' | 'phone_second' | 'line'>>(
  contacts: readonly T[],
  lead: Pick<WebsiteLead, 'phone' | 'email' | 'line_id'>,
): T | null {
  const phone = phoneDigits(lead.phone);
  const line = handle(lead.line_id);
  const email = (lead.email ?? '').trim().toLowerCase();
  return contacts.find(c =>
    (phone !== '' && [c.phone, c.phone_second].some(p => p && phoneDigits(p) === phone))
    || (email !== '' && (c.email ?? '').trim().toLowerCase() === email)
    || (line !== '' && handle(c.line) === line),
  ) ?? null;
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */

export const WEBSITE_LEAD_SOURCE = 'Website form';
export const WEBSITE_LEAD_NEXT_ACTION = 'Reply to their website enquiry';

/** "Website enquiry 22 Oct: “…” (utm facebook / paid)", the line kept on the account. */
export function enquiryNote(lead: WebsiteLead, today: string): string {
  const said = lead.message ? `: “${lead.message}”` : '';
  const utm = [lead.utm_source, lead.utm_medium].filter(Boolean).join(' / ');
  return `Website enquiry ${dayLabel(today)}${said}${utm ? ` (utm ${utm})` : ''}`;
}

export function newWebsiteCompany(lead: WebsiteLead, today: string) {
  return {
    name: lead.business_name!,
    status: 'prospect',
    lead_source: WEBSITE_LEAD_SOURCE,
    account_owner: 'Pat',
    ...websiteAcquisition(lead),
    notes: enquiryNote(lead, today),
  };
}

/** The person who wrote. A named sender is a person; without a name it is only a route in. */
export function websiteContact(companyId: string, lead: WebsiteLead) {
  return {
    company_id: companyId,
    name: lead.contact_name ?? `${lead.business_name} enquiry`,
    identity_quality: lead.contact_name ? 'named' : 'unknown',
    email: lead.email,
    phone: lead.phone,
    line: lead.line_id,
    status: 'uncontacted',
    notes: 'Wrote in through the website form',
  };
}

/**
 * The Research deal a new lead starts with (newLeadDeal), but due today: they wrote in and
 * are waiting, so it goes straight onto This week rather than waiting for an owner search.
 */
export function websiteDeal(companyId: string, name: string, contactId: string | null, today: string) {
  return {
    ...newLeadDeal(companyId, name, null, today),
    priority: 'high',
    next_action: WEBSITE_LEAD_NEXT_ACTION,
    followup_date: today,
    contact_ids: contactId ? [contactId] : [],
  };
}

/* ── Telegram ─────────────────────────────────────────────────────────────── */

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A personal LINE ID opens with ~id, an official account with @id. */
const lineLink = (id: string) => id.startsWith('@')
  ? `https://line.me/R/ti/p/@${encodeURIComponent(id.slice(1))}`
  : `https://line.me/R/ti/p/~${encodeURIComponent(id)}`;

const MATCHED: Record<MatchedBy, string> = {
  name: 'same name',
  alias: 'a name or number you linked before',
  phone: 'same phone',
  email: 'same email',
  line: 'same LINE',
};

export interface LeadOutcome {
  companyName: string;
  /** set when the enquiry was linked to an account Pat already has */
  matched: MatchedBy | null;
  /** the deal created now, or the account's open deal it joined */
  deal: { created: boolean; title: string } | null;
}

/** The alert Pat gets on the LeadPulse bot, with what is needed to reply straight away. */
export function websiteLeadMessage(lead: WebsiteLead, outcome: LeadOutcome): string {
  const { acquisition_source, acquisition_campaign } = websiteAcquisition(lead);
  const from = acquisition_source === 'meta_ad' ? 'Meta ad' : acquisition_source === 'social_post' ? 'Social post' : 'Website';
  const lines = [`🆕 <b>${from} enquiry: ${escapeHtml(lead.business_name ?? '')}</b>`];
  if (acquisition_campaign) lines.push(`<i>${escapeHtml(acquisition_campaign)}</i>`);
  const reach = [
    lead.contact_name && escapeHtml(lead.contact_name),
    lead.phone && escapeHtml(lead.phone),
    lead.line_id && `LINE <a href="${lineLink(lead.line_id)}">${escapeHtml(lead.line_id)}</a>`,
    lead.email && escapeHtml(lead.email),
  ].filter(Boolean);
  lines.push(reach.join(' · '));
  if (lead.message) lines.push('', `“${escapeHtml(lead.message.length > 600 ? `${lead.message.slice(0, 600)}…` : lead.message)}”`);
  lines.push('');
  lines.push(outcome.matched
    ? `🔗 Already in LeadPulse as <b>${escapeHtml(outcome.companyName)}</b> (${MATCHED[outcome.matched]}).`
    : 'New account added.');
  if (outcome.deal) {
    lines.push(outcome.deal.created
      ? `On This week today: ${escapeHtml(outcome.deal.title)}.`
      : `Open deal: ${escapeHtml(outcome.deal.title)}.`);
  } else {
    lines.push('No deal yet: add one from Pipeline.');
  }
  return lines.join('\n');
}
