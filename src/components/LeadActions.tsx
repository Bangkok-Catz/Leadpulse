'use client';

// ─── This week: today's leads, as steps in the run ───
// Leads are prospects to contact today (utils/prospecting.ts). This week shows each as a
// row in the run; this file holds what a lead row does: log its touch in one tap (the deal
// then waits on a reply with the next touch dated), park it, draft the message, and say the
// next step in a few words. A reply turns the lead into an ordinary Pipeline deal.

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Mail, MapPin, MessageCircle, Phone, type LucideIcon } from 'lucide-react';
import type { Contact, Deal, MeetingType } from '@/types/crm';
import MessageDraft, { type DraftChannel } from '@/components/MessageDraft';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import * as crm from '@/lib/crm';
import { buildCloseUpdate } from '@/utils/deal-close';
import { getWorkflowAction } from '@/utils/deal-workflow';
import { buildInteractionWorkflowUpdate } from '@/utils/interaction-workflow';
import { dayLabel as day } from '@/utils/proposals';
import { TOUCH_LIMIT, afterTouch, notNowDate, touchLabel, touchTitle, type Lead } from '@/utils/prospecting';

const ROUTE_ICON: Record<MeetingType, LucideIcon> = {
  dm: MessageCircle, call: Phone, email: Mail, meeting: MapPin,
  sample_sent: MapPin, note: MessageCircle, nudge: MessageCircle, reward: MessageCircle,
};
const LOG_LABEL: Partial<Record<MeetingType, string>> = { call: 'Log call', meeting: 'Log visit' };
const CHANNEL_TYPE: Record<DraftChannel, MeetingType> = { email: 'email', dm: 'dm', call: 'call' };

const btn = 'inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-clay-hairline px-2.5 text-xs font-medium text-clay-ink transition-transform duration-150 ease-out hover:border-clay-lavender active:scale-[0.97] disabled:opacity-50';

export function Dots({ done }: { done: number }) {
  return (
    <span className="mr-1.5 inline-flex gap-[3px] align-middle" aria-hidden="true">
      {Array.from({ length: TOUCH_LIMIT }, (_, i) => (
        <span key={i} className={clsx('h-[7px] w-[7px] rounded-full', i < done ? 'bg-clay-lavender' : 'bg-clay-hairline')} />
      ))}
    </span>
  );
}

/** A lead's tools, shown when its row is opened: Draft the message, or put it aside. */
export function LeadTools({ lead, today, contacts, busy, onLog, onPark }: {
  lead: Lead;
  today: string;
  contacts: Contact[];
  busy: boolean;
  onLog: (lead: Lead, type: MeetingType) => void;
  onPark: (lead: Lead, why: 'not_now' | 'not_fit') => void;
}) {
  const [open, setOpen] = useState(false);
  const { company, deal, route } = lead;
  const finished = lead.next > TOUCH_LIMIT;
  return (
    <div data-testid="lead-tools">
      <p className="text-xs text-clay-body"><Dots done={lead.touches} />{touchLabel(lead.next, route)}{lead.lastTouch ? ` · last touch ${day(lead.lastTouch)}` : ''}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!finished && route.kind !== 'visit' && (
          <button type="button" className={btn} aria-expanded={open} onClick={() => setOpen(v => !v)}>Draft</button>
        )}
        <button type="button" className={btn} disabled={busy} onClick={() => onPark(lead, 'not_now')}>Not now · back {day(notNowDate(today))}</button>
        <button type="button" className={btn} disabled={busy} onClick={() => onPark(lead, 'not_fit')}>Not a fit</button>
        <Link href={`/companies?company=${company.id}`} className={btn}>Open account</Link>
      </div>
      {open && (
        <div className="mt-2 rounded-lg bg-white p-3 dark:bg-clay-card">
          <MessageDraft
            deal={deal}
            company={company}
            contacts={contacts}
            sendCount={lead.touches}
            onLog={channel => { setOpen(false); onLog(lead, CHANNEL_TYPE[channel]); }}
          />
        </div>
      )}
    </div>
  );
}

/** Logging a lead's touch in one tap, and parking a lead. Shared by This week's rows. */
export function useLeadActions(today: string) {
  const { addMeeting, refresh, logActivity } = useCrm();
  const { addToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const saveDeal = async (deal: Deal, updates: Partial<Deal>, label: string, description: string) => {
    await crm.updateDealIfUnchanged(deal.id, deal.updated_at, updates);
    await refresh();
    logActivity({
      type: 'edit', entity: 'deal', entityId: deal.id, label, description,
      undoPayload: {
        workflow_action: deal.workflow_action ?? null, stage: deal.stage, followup_date: deal.followup_date ?? null,
        next_action: deal.next_action ?? null, last_outcome: deal.last_outcome ?? null, park_reason: deal.park_reason ?? null,
        nudge_stage: deal.nudge_stage ?? null,
      },
    });
  };

  // One tap: the touch is saved like the log form saves it, then the deal waits on a reply
  // with the next touch dated. If the deal update fails, the touch is still saved and said so.
  const log = async (lead: Lead, type: MeetingType) => {
    const { deal } = lead;
    const title = touchTitle({ ...lead, route: { ...lead.route, type } });
    const next = afterTouch(lead, today);
    setBusy(deal.id);
    try {
      await addMeeting({
        description: title, type, date: today, company_id: lead.company.id,
        contact_ids: lead.route.contact ? [lead.route.contact.id] : [], deal_id: deal.id,
        product: deal.product || 'Butter', summary: null, outcome: null, followup_date: next.followup_date, direction: 'outbound',
      });
    } catch (err) {
      addToast(`Could not log the touch: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      setBusy(null);
      return;
    }
    try {
      const lane = getWorkflowAction(deal) === 'outreach'
        ? buildInteractionWorkflowUpdate(deal, 'reply', { kind: 'outbound_attempt', outcome: null, interactionDescription: title, channel: type })
        : null;
      await saveDeal(deal, { ...(lane ?? {}), ...next }, 'Touch logged', `${deal.client}: ${title}`);
      addToast(lead.next >= TOUCH_LIMIT ? 'Last touch logged' : `Touch ${lead.next} logged · next ${day(next.followup_date)}`);
    } catch (err) {
      addToast(`Touch saved, but the next date didn't update. Open the deal to set it. ${err instanceof Error ? err.message : ''}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const park = async (lead: Lead, why: 'not_now' | 'not_fit') => {
    const { deal } = lead;
    const reason = why === 'not_now'
      ? (lead.touches >= TOUCH_LIMIT ? 'Not now: no reply after 5 touches' : 'Not now')
      : 'Not a fit';
    const { updates } = buildCloseUpdate(deal, { kind: 'park', park_reason: reason, followup_date: why === 'not_now' ? notNowDate(today) : null });
    setBusy(deal.id);
    try {
      await saveDeal(deal, updates, 'Lead parked', `${deal.client}: ${reason}`);
      addToast(why === 'not_now' ? `${lead.company.name}: back ${day(notNowDate(today))}` : `${lead.company.name}: parked as not a fit`);
    } catch (err) {
      addToast(`Could not park: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return { log, park, busy };
}

const STEP_WORDS: Record<number, string> = { 1: 'First message', 2: 'Gentle follow-up', 3: 'Second follow-up', 4: 'Visit or call', 5: 'Last try' };

/** The lead's next step in a few words: "First message on Shop LINE, ask for the owner". */
export function leadAction(lead: Lead): string {
  const { route } = lead;
  if (lead.next > TOUCH_LIMIT) return 'No reply after 5 touches: not now?';
  const step = STEP_WORDS[lead.next] ?? 'Follow up';
  const [where, rest] = route.label.split(' · ');
  if (route.kind === 'visit') return rest === 'drop by with a sample' ? 'Drop by with a sample' : `Visit, ${rest}`;
  if (route.kind === 'shop') return `${step} on ${where}, ${rest}`;
  if (route.type === 'call') return lead.next === 1 ? `Call ${where}` : `${step}: call ${where}`;
  if (route.type === 'email') return `${step} to ${where} by email`;
  return `${step} to ${where} on ${rest ?? 'LINE'}`;
}

/** The way in, short: "Shop LINE", "Mali", "Visit". */
export const leadChannel = (lead: Lead) => (lead.route.kind === 'visit' ? 'Visit' : lead.route.label.split(' · ')[0]);

export { ROUTE_ICON, LOG_LABEL };
