// ─── A contact's ways in, read and checked the same way everywhere ───
// Pure. A contact has one box per app: LINE, Instagram, WhatsApp, phone, email (Instagram and
// WhatsApp since migration 20261118090000). Before that there was only a LINE box, and 24
// contacts carry Instagram handles or WhatsApp numbers in it ("IG @ubuntueat", "WhatsApp +65 …").
// channelsOf reads those old values correctly, so "Julia · LINE" becomes "Julia · Instagram"
// without anyone retyping it.
//
// The checks here never block a save on their own: they say what looks wrong and, where it is
// clear, offer the one-tap fix (move a second number to Alternate phone, an Instagram handle to
// the Instagram box). The one thing a form must ask is who the contact is.

import type { Contact, ContactIdentityQuality } from '../types/crm';

export type ChannelKey = 'line' | 'instagram' | 'whatsapp' | 'phone' | 'email';

export type Channels = Record<ChannelKey, string | null>;

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  line: 'LINE', instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'phone', email: 'email',
};

/** The order a message goes out in: the chat apps first, then a call, then email. */
export const CHANNEL_ORDER: ChannelKey[] = ['line', 'instagram', 'whatsapp', 'phone', 'email'];

const clean = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t || null;
};

const IG_HANDLE = String.raw`@?([A-Za-z0-9._]{2,30})`;
const IG = [
  new RegExp(String.raw`instagram\.com/${IG_HANDLE}`, 'i'),
  new RegExp(String.raw`\b(?:ig|instagram)\b\s*[:\-]?\s*${IG_HANDLE}`, 'i'),
  new RegExp(String.raw`@([A-Za-z0-9._]{2,30})\s*\(\s*(?:ig|instagram)\s*\)`, 'i'),
];
const WA = [
  /wa\.me\/(\+?\d{7,15})/i,
  /whats\s?app\b[^+\d]{0,30}(\+?\d[\d\s().-]{5,}\d)/i,
];
const LINE_URL = /\b(?:https?:\/\/)?(?:lin\.ee|line\.me|page\.line\.me)\/[^\s;,)]+/i;
const LINE_LABELLED = /\bline(?:\s*oa|\s*@)?\b\s*[:\-]?\s*(@[\w.\-]{2,40})/i;
const OTHER_APP = /\b(?:ig|instagram|whats\s?app|wa\.me|facebook|fb)\b/i;

export interface LegacyLine {
  line: string | null;
  instagram: string | null;
  whatsapp: string | null;
  /** something else was written there too (Facebook, a note) */
  other: boolean;
}

/**
 * What an old LINE box actually holds. A plain value ("@holeybkk", "lin.ee/…") is LINE. A value
 * that names another app is split: "Line @loaves / IG @loaves_gf" → LINE @loaves, Instagram
 * loaves_gf. Nothing is invented: a part that is not clearly one app is left out.
 */
export function splitLegacyLine(raw: string | null | undefined): LegacyLine {
  const text = clean(raw);
  if (!text) return { line: null, instagram: null, whatsapp: null, other: false };
  if (!OTHER_APP.test(text)) {
    // "Line https://lin.ee/…" or "LINE: @shop" keep only the ID; anything else is the ID as typed.
    const line = LINE_URL.exec(text)?.[0] ?? LINE_LABELLED.exec(text)?.[1] ?? text;
    return { line, instagram: null, whatsapp: null, other: false };
  }
  const instagram = IG.map(re => re.exec(text)?.[1]).find(Boolean) ?? null;
  const whatsapp = WA.map(re => re.exec(text)?.[1]).find(Boolean)?.trim() ?? null;
  const line = LINE_URL.exec(text)?.[0] ?? LINE_LABELLED.exec(text)?.[1] ?? null;
  const other = /\b(?:facebook|fb)\b/i.test(text);
  return { line, instagram: instagram ? instagram.replace(/\.$/, '') : null, whatsapp, other };
}

/** Every way in for a contact: its own boxes first, then what an old LINE box held. */
export function channelsOf(c: Pick<Contact, 'line' | 'phone' | 'email'> & Partial<Pick<Contact, 'instagram' | 'whatsapp'>>): Channels {
  const legacy = splitLegacyLine(c.line);
  return {
    line: legacy.line,
    instagram: clean(c.instagram) ?? legacy.instagram,
    whatsapp: clean(c.whatsapp) ?? legacy.whatsapp,
    phone: clean(c.phone),
    email: clean(c.email),
  };
}

/** The first way in, in CHANNEL_ORDER, or null when the contact has none. */
export function ownChannel(c: Parameters<typeof channelsOf>[0]): { key: ChannelKey; value: string; label: string } | null {
  const channels = channelsOf(c);
  const key = CHANNEL_ORDER.find(k => channels[k]);
  return key ? { key, value: channels[key] as string, label: CHANNEL_LABEL[key] } : null;
}

/** "ubuntueat" from "@ubuntueat", "instagram.com/ubuntueat/", "IG @ubuntueat". */
export function instagramHandle(raw: string | null | undefined): string | null {
  const text = clean(raw);
  if (!text) return null;
  const labelled = IG.map(re => re.exec(text)?.[1]).find(Boolean);
  const handle = (labelled ?? text.replace(/^@/, '')).replace(/[/.]+$/, '');
  return /^[A-Za-z0-9._]{2,30}$/.test(handle) ? handle : null;
}

/** A link that opens the chat, or null when the value can't be turned into one. */
export function channelLink(key: ChannelKey, value: string | null | undefined): string | null {
  const v = clean(value);
  if (!v) return null;
  if (key === 'instagram') {
    const h = instagramHandle(v);
    return h ? `https://instagram.com/${h}` : null;
  }
  if (key === 'whatsapp') {
    const digits = v.replace(/\D/g, '');
    return digits.length >= 8 ? `https://wa.me/${digits}` : null;
  }
  if (key === 'line') {
    const url = LINE_URL.exec(v)?.[0];
    if (url) return /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const id = /^@?([\w.\-]{2,40})$/.exec(v)?.[1];
    return id ? `https://line.me/R/ti/p/${v.startsWith('@') ? '@' : '~'}${id}` : null;
  }
  if (key === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : null;
  const digits = v.replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 7 ? `tel:${digits}` : null;
}

/* ── Checks for the form ─────────────────────────────────────────────────── */

export interface FieldHint {
  /** what looks wrong, in a few words */
  message: string;
  /** the boxes a one-tap fix would set; absent when the fix needs Pat */
  fix?: Partial<Record<'phone' | 'phone_second' | 'line' | 'instagram' | 'whatsapp', string>>;
  /** the fix button's words */
  fixLabel?: string;
}

const NUMBER = /\+?\d[\d\s().-]{5,}\d/g;
const digitCount = (s: string) => s.replace(/\D/g, '').length;

/**
 * What looks wrong with a phone box, or null. A short note beside the number ("(office)",
 * "M:") is fine; an extension written after a slash ("2180 / 2200-4") is not a second number.
 */
export function phoneHint(raw: string | null | undefined, form: { phone_second?: string | null; whatsapp?: string | null } = {}): FieldHint | null {
  const text = clean(raw);
  if (!text) return null;
  if (/whats\s?app/i.test(text)) {
    const number = (text.match(NUMBER) ?? [])[0]?.trim();
    return number && !clean(form.whatsapp)
      ? { message: 'This is a WhatsApp number', fix: { phone: '', whatsapp: number }, fixLabel: 'Move to WhatsApp' }
      : { message: 'This is a WhatsApp number: it belongs in the WhatsApp box' };
  }
  const numbers = (text.match(NUMBER) ?? []).map(n => n.trim()).filter(n => digitCount(n) >= 7);
  if (numbers.length === 0) return { message: digitCount(text) ? 'Too short to be a phone number' : 'Not a phone number' };
  if (numbers.length === 2 && !clean(form.phone_second)) {
    return { message: 'Two numbers in one box', fix: { phone: numbers[0], phone_second: numbers[1] }, fixLabel: 'Move the second to Alternate phone' };
  }
  if (numbers.length >= 2) {
    return { message: `${numbers.length} numbers in one box: keep one here, one under Alternate phone, the rest in notes` };
  }
  return null;
}

/** What looks wrong with a LINE box, or null: another app's handle or number typed into it. */
export function lineHint(raw: string | null | undefined, form: { instagram?: string | null; whatsapp?: string | null } = {}): FieldHint | null {
  const text = clean(raw);
  if (!text || !OTHER_APP.test(text)) return null;
  const parts = splitLegacyLine(text);
  const fix: FieldHint['fix'] = { line: parts.line ?? '' };
  const moved: string[] = [];
  if (parts.instagram && !clean(form.instagram)) { fix.instagram = parts.instagram; moved.push('Instagram'); }
  if (parts.whatsapp && !clean(form.whatsapp)) { fix.whatsapp = parts.whatsapp; moved.push('WhatsApp'); }
  if (moved.length === 0 || parts.other) {
    return { message: 'This holds another app, not a LINE ID: move it to its own box or to notes' };
  }
  return { message: `This holds ${moved.join(' and ')}, not only LINE`, fix, fixLabel: `Move to ${moved.join(' and ')}` };
}

/* ── Who the contact is ──────────────────────────────────────────────────── */

/** The question every contact form asks. "Unknown" is never offered: it is what a form saved
 *  when it did not ask (52 contacts on 2026-11-17, most of them owners). */
export const IDENTITY_CHOICES: { value: Exclude<ContactIdentityQuality, 'unknown'>; label: string; hint: string }[] = [
  { value: 'named', label: 'A person', hint: 'Owner, chef, buyer: someone with a name' },
  { value: 'role_only', label: 'A role', hint: 'Name not known yet: "Head chef"' },
  { value: 'company_route', label: "The shop's channel", hint: 'Shop LINE, info@, front desk' },
];

/** Why a contact can't be saved yet, or null. */
export function identityProblem(identity: ContactIdentityQuality | null | undefined): string | null {
  return !identity || identity === 'unknown' ? 'Say who this is: a person, a role or the shop\'s channel' : null;
}
