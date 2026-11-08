import type { Company, Contact, Deal } from '@/types/crm';
import { isCompanyRoute } from '@/utils/contact-identity';
import { entityInitials } from '@/utils/entity-avatar';
import { getWorkflowAction } from '@/utils/deal-workflow';
import { businessDaysBetween } from '@/utils/business-time';

export type DealCardDueState = 'overdue' | 'today' | null;
/** hidden: a lead not contacted yet; its date is a plan, not a promise, so the card shows none. */
export type DealCardTimingTone = 'overdue' | 'today' | 'scheduled' | 'none' | 'hidden';

const PASSIVE_NEXT_ACTION = /^(awaiting|waiting|pending)\b/i;

/**
 * A next action the user can act on. A blank field and a passive state ("Awaiting their reply")
 * both mean the same thing to the card: there is nothing concrete to do, so offer to set one
 * instead of printing a dash.
 */
export function isConcreteNextAction(value?: string | null): boolean {
  const trimmed = value?.trim() || '';
  return !!trimmed && !PASSIVE_NEXT_ACTION.test(trimmed);
}

export type DealCardPrimaryActionId = 'log-outreach' | 'record-reply' | 'log-followup' | 'set-next-action';

export interface DealCardPrimaryAction {
  id: DealCardPrimaryActionId;
  label: string;
  hint: string;
  /** True when the action opens the log form. It never sends anything by itself. */
  opensLogForm: boolean;
}

export const NO_NEXT_ACTION_LABEL = 'Set next action';

/** One contextual primary action per card, derived from the lane. Never an automatic send. */
export function primaryCardAction(deal: Deal): DealCardPrimaryAction {
  const setAction: DealCardPrimaryAction = {
    id: 'set-next-action',
    label: NO_NEXT_ACTION_LABEL,
    hint: 'Opens the deal so you can set one concrete next action.',
    opensLogForm: false,
  };

  if (!isConcreteNextAction(deal.next_action)) return setAction;

  switch (getWorkflowAction(deal)) {
    case 'outreach':
      return {
        id: 'log-outreach',
        label: 'Log outreach',
        hint: 'Opens the log form — nothing is sent from this button.',
        opensLogForm: true,
      };
    case 'reply':
      return {
        id: 'record-reply',
        label: 'Paste reply',
        hint: "Opens the log form with the buyer's exact words first, for Laya to read.",
        opensLogForm: true,
      };
    case 'sample':
    case 'testing':
    case 'reschedule':
      return {
        id: 'log-followup',
        label: 'Log follow-up',
        hint: 'Opens the log form for the next follow-up.',
        opensLogForm: true,
      };
    default:
      return setAction;
  }
}

/** The nudge badge without its implementation code — the code stays in the tooltip. */
export function nudgeChipLabel(nudge: string | null): string | null {
  if (!nudge) return null;
  return nudge.replace(/\s*NG-\d{3}\s*/, ' ').replace(/\s+/g, ' ').trim();
}

export interface DealCardPresentation {
  contact: {
    name: string;
    role: string | null;
    initials: string;
    additionalCount: number;
    missing: boolean;
  };
  companyName: string;
  companyLogoUrl: string | null;
  product: string;
  nextAction: string;
  timing: {
    label: string;
    date: string | null;
    tone: DealCardTimingTone;
  };
}

/** "Fri 14 Nov" */
function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const ISO_DATE = /\b(20\d\d)-(\d\d)-(\d\d)\b/g;

/** "Send samples on 2026-11-04" → "Send samples on Wed 4 Nov": dates read like the rest of the app. */
export function humanizeDates(text: string): string {
  return text.replace(ISO_DATE, (match, y: string, m: string, d: string) => {
    const date = `${y}-${m}-${d}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? match : shortDay(date);
  });
}

export interface DealCardTimingOptions {
  /** today's date key, for "3d late" */
  today?: string;
  /** a lead with nothing logged yet (To contact): no date mark at all */
  notStarted?: boolean;
}

/**
 * The card's one date mark. Late reads "3d late" (in Waiting on reply, where the buyer owes
 * the reply, "Nudge due · 3d"); due today reads "Today"; a later date reads "Fri 14 Nov".
 */
function timingFor(deal: Deal, due: DealCardDueState, opts: DealCardTimingOptions): DealCardPresentation['timing'] {
  // Not contacted yet, or already won or lost: a date means nothing on the card.
  if (opts.notStarted || deal.stage === 'closed_won' || deal.stage === 'closed_lost') return { label: '', date: null, tone: 'hidden' };
  const waiting = getWorkflowAction(deal) === 'reply';
  if (due === 'overdue' && deal.followup_date) {
    const days = opts.today ? Math.max(1, businessDaysBetween(deal.followup_date, opts.today)) : null;
    if (waiting) return { label: 'Nudge due', date: days ? `${days}d` : null, tone: 'overdue' };
    return { label: days ? `${days}d late` : 'Late', date: null, tone: 'overdue' };
  }
  if (due === 'today') return { label: waiting ? 'Nudge today' : 'Today', date: null, tone: 'today' };
  if (deal.followup_date) return { label: shortDay(deal.followup_date), date: null, tone: 'scheduled' };
  return { label: 'No date', date: null, tone: 'none' };
}

/** The usual product goes unsaid on a card; anything else is worth a word. */
export function productNote(product: string | null | undefined): string | null {
  const trimmed = product?.trim();
  if (!trimmed || /^butter$/i.test(trimmed)) return null;
  return trimmed;
}

export function buildDealCardPresentation(
  deal: Deal,
  contacts: Contact[],
  companies: Company[],
  due: DealCardDueState,
  timingOptions: DealCardTimingOptions = {},
): DealCardPresentation {
  // People only: a company route (info@, general LINE) is a channel, not "the contact".
  const linkedContacts = (deal.contact_ids || [])
    .map(contactId => contacts.find(contact => contact.id === contactId))
    .filter((contact): contact is Contact => Boolean(contact) && !isCompanyRoute(contact!));
  const primaryContact = linkedContacts[0] ?? null;
  const company =
    (deal.company_id ? companies.find(item => item.id === deal.company_id) : null) ??
    (primaryContact?.company_id ? companies.find(item => item.id === primaryContact.company_id) : null);

  const contactName = primaryContact?.name.trim() || 'Contact not identified';

  return {
    contact: primaryContact
      ? {
          name: contactName,
          role: primaryContact.job_title?.trim() || 'Role unknown',
          initials: entityInitials(contactName),
          additionalCount: Math.max(0, linkedContacts.length - 1),
          missing: false,
        }
      : {
          name: 'Contact not identified',
          role: null,
          initials: '?',
          additionalCount: 0,
          missing: true,
        },
    companyName: company?.name.trim() || deal.client.trim() || 'Customer not identified',
    companyLogoUrl: company?.logo_url?.trim() || null,
    product: deal.product?.trim() || 'Product not set',
    nextAction: humanizeDates(deal.next_action?.trim() || 'No next action set'),
    timing: timingFor(deal, due, timingOptions),
  };
}

// ── Priority chip presentation ──
// Moved here from lead-scoring.ts: these are Tailwind classes, not scoring
// rules, and this module is where deal-card presentation lives.
export const PRIORITY_CLASSES: Record<Deal['priority'], string> = {
  high: 'bg-clay-error/15 text-clay-error border-l-2 border-clay-error/40 px-2 py-0.5 rounded text-xs font-semibold min-h-[20px]',
  medium: 'bg-clay-ochre/15 text-clay-ochre border-l-2 border-clay-ochre/30 px-2 py-0.5 rounded text-xs font-medium min-h-[20px]',
  low: 'bg-clay-card text-clay-muted border-l-2 border-clay-hairline/50 px-2 py-0.5 rounded text-xs min-h-[20px]',
};

export const PRIORITY_LABELS: Record<Deal['priority'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

