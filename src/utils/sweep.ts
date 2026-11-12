// ─── The Reach-out sweep: sort the pile of leads never contacted ───
// Pure. The pile is Pipeline's To contact list (utils/to-contact.ts: Outreach, nothing logged)
// narrowed to open leads at prospect accounts (utils/prospecting.ts isOpenLead), not kept yet. Pat sees one at a time and picks Keep, Not now or Not a fit. Keep stamps
// kept_at, so the lead leaves the pile and comes first in Today's leads; Not now and Not a fit
// park it exactly as a lead row's buttons do (back in 60 days, or for good). No points: sorting
// is housekeeping, not a touch.

import type { Company, Contact, Deal, Meeting } from '../types/crm';
import { buildCloseUpdate } from './deal-close.ts';
import { splitToContact } from './to-contact.ts';
import { bestRoute, isOpenLead, notNowDate, type Route } from './prospecting.ts';

export type SweepChoice = 'keep' | 'not_now' | 'not_fit';

export interface SweepCard {
  deal: Deal;
  company: Company;
  /** the best way in, or null while the owner search hasn't found one */
  route: Route | null;
  /** Laya's best fit (0..1), or null when not graded */
  fit: number | null;
  /** where the lead came from, in a few words: "Partner research · Sep" */
  source: string | null;
}

const PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "VG Saveur Thailand partner research 2026-09-02" → "Partner research · Sep". */
export function sourceLabel(raw: string | null | undefined, createdAt?: string | null): string | null {
  const text = (raw ?? '').trim();
  const date = text.match(/\b(20\d\d)-(\d\d)-\d\d\b/) ?? (createdAt ?? '').match(/^(20\d\d)-(\d\d)/);
  const month = date ? MONTHS[Number(date[2]) - 1] : null;
  const rules: [RegExp, string][] = [
    [/partner research/i, 'Partner research'],
    [/fine dining/i, 'Fine dining list'],
    [/happycow/i, 'HappyCow'],
    [/hermes/i, 'Hermes search'],
    [/reddit/i, 'Reddit'],
    [/instagram|\big\b/i, 'Instagram'],
    [/market research/i, 'Market research'],
    [/pat[- ](supplied|direct)/i, 'Added by you'],
    [/official (site|homepage|hotel)/i, 'Own website'],
  ];
  const name = rules.find(([re]) => re.test(text))?.[1] ?? (text ? text.replace(/\s*\d{4}-\d\d-\d\d.*$/, '').slice(0, 32) : null);
  if (!name) return month;
  return month ? `${name} · ${month}` : name;
}

/** The research notes' labelled facts, for a card read at a glance: where, what kind, why it fits.
 *  Notes come from several research runs ("City/market: Bangkok", "City: Chiang Mai.",
 *  "Country/market: Philippines; city: Quezon City", "Why fit: …", "Fit: …"); null where absent. */
export function noteFacts(notes: string | null | undefined): { place: string | null; type: string | null; why: string | null; rest: string | null } {
  const text = (notes ?? '').replace(/\r/g, '');
  const field = (label: string) => {
    const m = text.match(new RegExp(`(?:^|\\n|\\.\\s|\\|\\s)(?:${label})\\s*:\\s*([^\\n]+?)(?=\\.\\s+[A-Z][\\w/ ]{2,24}:|\\s\\|\\s|\\n|$)`, 'i'));
    return m?.[1]?.trim().replace(/[.;,]\s*$/, '') || null;
  };
  const place = field('City/market|Country/market|City|Location')?.replace(/;\s*city:\s*/i, ' · ') ?? null;
  const type = field('Type');
  // One sentence is enough to decide on.
  const why = field('Why fit|Fit|Source description')?.split(/(?<=[a-z)]\.)\s+(?=[A-Z])/)[0].replace(/\.$/, '') ?? null;
  // Without labelled facts, the note itself, minus the research bookkeeping lines.
  const rest = place || why ? null : text
    .split('\n')
    .filter(line => line.trim() && !/^\s*(source|sources|research-only|public routes|source priority|tier)\b/i.test(line))
    .join(' ')
    .trim() || null;
  return { place, type, why, rest };
}

/** The pile, best fit first: open leads with nothing logged and not kept. */
export function buildSweepPile(input: {
  deals: Deal[];
  companies: Company[];
  contacts: Contact[];
  meetings: Meeting[];
  fits: Map<string, number>;
}): SweepCard[] {
  const companies = new Map(input.companies.map(c => [c.id, c]));
  const pile: SweepCard[] = [];
  for (const deal of splitToContact(input.deals, input.meetings).toContact) {
    if (deal.kept_at) continue;
    const company = deal.company_id ? companies.get(deal.company_id) : undefined;
    if (!company || !isOpenLead(deal, company, input.meetings)) continue;
    pile.push({
      deal,
      company,
      route: bestRoute(company, input.contacts),
      fit: input.fits.get(company.id) ?? null,
      source: sourceLabel(company.lead_source, deal.created_at),
    });
  }
  return pile.sort((a, b) =>
    (b.fit ?? -1) - (a.fit ?? -1)
    || (PRIORITY[a.deal.priority ?? 'medium'] ?? 1) - (PRIORITY[b.deal.priority ?? 'medium'] ?? 1)
    || a.company.name.localeCompare(b.company.name));
}

export const SWEEP_LABEL: Record<SweepChoice, string> = { keep: 'Keep', not_now: 'Not now', not_fit: 'Not a fit' };

/** What a choice saves on the deal, and what Undo puts back. */
export function sweepUpdate(deal: Deal, choice: SweepChoice, today: string): { patch: Partial<Deal>; before: Partial<Deal> } {
  if (choice === 'keep') {
    return { patch: { kept_at: today }, before: { kept_at: deal.kept_at ?? null } };
  }
  const { updates } = buildCloseUpdate(deal, {
    kind: 'park',
    park_reason: choice === 'not_now' ? 'Not now' : 'Not a fit',
    followup_date: choice === 'not_now' ? notNowDate(today) : null,
  });
  const before: Partial<Deal> = {};
  for (const key of Object.keys(updates) as (keyof Deal)[]) {
    (before as Record<string, unknown>)[key] = deal[key] ?? null;
  }
  return { patch: updates, before };
}
