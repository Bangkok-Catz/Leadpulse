// ─── A run button tapped in Telegram ───
// The morning message and the 4 pm nudge carry one button per run step ("✓ Mello Vegan ·
// Called"). A tap logs the step exactly as the app's button does (utils/quick-log.ts, or the
// lead ladder for a lead), moves a check-in's next date, then turns the button into a tick.
// A step already touched today is never logged twice. Server only.

import type { Company, Contact, Deal, Meeting } from '@/types/crm';
import * as crm from '@/lib/crm';
import { answerTelegramCallback, editTelegramButtons, type InlineButton } from '@/lib/telegram';
import { businessDateKey } from '@/utils/business-time';
import { isTouch } from '@/utils/game';
import { LOGGED_CALLBACK, parseQuickCallback } from '@/utils/game-digest';
import { buildLeadTouch } from '@/utils/lead-action';
import { buildTodaysLeads } from '@/utils/prospecting';
import { shortDate } from '@/utils/quests';
import { QUICK, buildQuickLog, type NewMeeting } from '@/utils/quick-log';
import { planRetentionTouch } from '@/utils/retention-touch';

export interface QuickTapUpdate {
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat?: { id?: number }; reply_markup?: { inline_keyboard?: InlineButton[][] } };
  };
}

export interface QuickTapData {
  deals: Deal[];
  companies: Company[];
  contacts: Contact[];
  meetings: Meeting[];
  fits: Map<string, number>;
}

export interface QuickTapDeps {
  today: () => string;
  load: () => Promise<QuickTapData>;
  createMeeting: (meeting: NewMeeting) => Promise<unknown>;
  updateDealIfUnchanged: (id: string, updatedAt: string, patch: Partial<Deal>) => Promise<unknown>;
  updateCompany: (id: string, patch: Partial<Company>) => Promise<unknown>;
  updateContact: (id: string, patch: Partial<Contact>) => Promise<unknown>;
  logActivity: (event: { type: string; entity: string; entity_id: string; label: string; description: string; undo_payload: Record<string, unknown> }) => Promise<unknown>;
  answer: (callbackId: string, text: string) => Promise<void>;
  editButtons: (messageId: number, buttons: InlineButton[][]) => Promise<void>;
}

const liveDeps: QuickTapDeps = {
  today: () => businessDateKey(),
  load: async () => {
    const [deals, companies, contacts, meetings, fits] = await Promise.all([
      crm.getDeals(), crm.getCompanies(), crm.getContacts(), crm.getMeetings(),
      crm.getCompanyFits().then(rows => new Map([...rows].map(([id, fit]) => [id, fit.best.noul]))).catch(() => new Map<string, number>()),
    ]);
    return {
      deals: (deals as Deal[]).map(deal => ({ ...deal, contact_ids: deal.contact_ids || [] })),
      companies: companies as Company[],
      contacts: contacts as Contact[],
      meetings: (meetings as Meeting[]).map(m => ({ ...m, contact_ids: m.contact_ids || [], direction: m.direction ?? null })),
      fits,
    };
  },
  createMeeting: meeting => crm.createMeeting(meeting),
  updateDealIfUnchanged: (id, updatedAt, patch) => crm.updateDealIfUnchanged(id, updatedAt, patch),
  updateCompany: (id, patch) => crm.updateCompany(id, patch),
  updateContact: (id, patch) => crm.updateContact(id, patch),
  logActivity: event => crm.createActivityEvent(event),
  answer: answerTelegramCallback,
  editButtons: editTelegramButtons,
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'unknown error');

/** The tapped button becomes a tick that does nothing; the others stay. */
function tickButtons(keyboard: InlineButton[][] | undefined, tapped: string, name: string): InlineButton[][] | null {
  if (!keyboard) return null;
  return keyboard.map(row => row.map(button => (
    button.callback_data === tapped ? { text: `✓ ${name} · logged`, callback_data: LOGGED_CALLBACK } : button
  )));
}

export async function handleQuickLogTap(update: QuickTapUpdate, chatId: string, deps: QuickTapDeps = liveDeps): Promise<string> {
  const query = update.callback_query;
  if (!query) return 'ignored: not a button press';
  if (String(query.message?.chat?.id ?? '') !== chatId) return 'ignored: another chat';
  if (query.data === LOGGED_CALLBACK) {
    await deps.answer(query.id, 'Already logged');
    return 'ignored: already logged';
  }
  const parsed = parseQuickCallback(query.data);
  if (!parsed) {
    await deps.answer(query.id, 'Unknown button');
    return 'ignored: unknown button';
  }
  const { kind, target } = parsed;
  const today = deps.today();
  const data = await deps.load();
  const companyName = (id: string | null | undefined) => (id ? data.companies.find(c => c.id === id)?.name : null);

  // The step and what logging it saves.
  let name: string;
  let meeting: NewMeeting;
  let dealPatch: Partial<Deal> = {};
  let before: Partial<Deal> = {};
  let deal: Deal | null = null;
  let followupDate: string | null = null;
  let companyPatch: Partial<Company> | null = null;
  let label: string = QUICK[kind].label;

  if (target.type === 'company') {
    const company = data.companies.find(c => c.id === target.companyId);
    if (!company) {
      await deps.answer(query.id, 'That account is no longer in LeadPulse');
      return 'ignored: company gone';
    }
    name = company.name;
    meeting = buildQuickLog({ kind, today, companyId: company.id }).meeting;
    // As the app does: a check-in moves the account's next check-in date (no reward draw here).
    if (target.tier !== 'reorder_only') {
      companyPatch = planRetentionTouch({ company, tier: target.tier, orderCount: 0, today })?.companyPatch ?? null;
    }
  } else {
    deal = data.deals.find(d => d.id === target.dealId) ?? null;
    if (!deal) {
      await deps.answer(query.id, 'That deal is no longer in LeadPulse');
      return 'ignored: deal gone';
    }
    name = companyName(deal.company_id) || deal.client || deal.title || 'Deal';
    const lead = target.type === 'lead'
      ? (() => {
          const leads = buildTodaysLeads({ ...data, today });
          return [...leads.today, ...leads.more].find(l => l.deal.id === target.dealId) ?? null;
        })()
      : null;
    try {
      if (lead) {
        const touch = buildLeadTouch(lead, QUICK[kind].type, today);
        ({ meeting, dealPatch, before, followupDate } = touch);
        label = touch.title;
      } else {
        ({ meeting, dealPatch, before, followupDate } = buildQuickLog({ kind, today, deal }));
      }
    } catch (err) {
      await deps.answer(query.id, `${errorText(err)}`);
      return `refused: ${errorText(err)}`;
    }
  }

  const tapped = query.data!;
  const messageId = query.message?.message_id;
  const markLogged = async () => {
    const buttons = tickButtons(query.message?.reply_markup?.inline_keyboard, tapped, name);
    if (buttons && messageId) await deps.editButtons(messageId, buttons).catch(() => undefined);
  };

  // A double tap, or a step already logged in the app today: say so, log nothing.
  const already = data.meetings.some(m => m.date === today && isTouch(m) && (
    target.type === 'company' ? m.company_id === target.companyId : m.deal_id === target.dealId
  ));
  if (already) {
    await deps.answer(query.id, `${name}: already logged today`);
    await markLogged();
    return 'ignored: already logged today';
  }

  try {
    await deps.createMeeting(meeting);
  } catch (err) {
    await deps.answer(query.id, `Could not log ${name}. Tap again.`);
    return `failed: ${errorText(err)}`;
  }
  // Last-touch dates stay honest, as the app's save does.
  await Promise.all([
    ...meeting.contact_ids.map(id => deps.updateContact(id, { last_contacted_date: today }).catch(() => null)),
    ...(meeting.company_id ? [deps.updateCompany(meeting.company_id, { last_contact_date: today }).catch(() => null)] : []),
  ]);

  let note = '';
  if (deal && Object.keys(dealPatch).length > 0) {
    try {
      await deps.updateDealIfUnchanged(deal.id, deal.updated_at, dealPatch);
      await deps.logActivity({
        type: 'edit', entity: 'deal', entity_id: deal.id, label: `${QUICK[kind].label} (Telegram)`,
        description: `${name}: ${label}`, undo_payload: before as Record<string, unknown>,
      }).catch(() => null);
    } catch {
      note = ' · the deal date did not update, open it to set one';
    }
  }
  if (companyPatch && target.type === 'company') {
    try {
      await deps.updateCompany(target.companyId, companyPatch);
    } catch {
      note = ' · the next check-in date did not update';
    }
  }

  await deps.answer(query.id, `Logged: ${name} · ${QUICK[kind].label}${followupDate && !note ? ` · next ${shortDate(followupDate)}` : ''}${note}`);
  await markLogged();
  return `logged: ${kind}`;
}
