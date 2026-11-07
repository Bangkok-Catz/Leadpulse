'use client';

// ─── This week: today's leads ───
// A few prospects to contact today, follow-ups first, then new leads by Laya's fit. Each row
// says how to reach the owner and which of five touches is next; Draft opens the message
// library, and one tap logs the touch and sets the next one. A reply turns the lead into an
// ordinary Pipeline deal. Which leads and when: utils/prospecting.ts.

import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Mail, MapPin, MessageCircle, MoreHorizontal, Phone, Search, type LucideIcon } from 'lucide-react';
import type { Contact, Deal, MeetingType } from '@/types/crm';
import CompanyLogo from '@/components/CompanyLogo';
import MessageDraft, { type DraftChannel } from '@/components/MessageDraft';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import * as crm from '@/lib/crm';
import { buildCloseUpdate } from '@/utils/deal-close';
import { getWorkflowAction } from '@/utils/deal-workflow';
import { buildInteractionWorkflowUpdate } from '@/utils/interaction-workflow';
import { dayLabel as day } from '@/utils/proposals';
import {
  TOUCH_LIMIT, afterTouch, notNowDate, touchLabel, touchTitle,
  type Lead, type TodaysLeads as Leads,
} from '@/utils/prospecting';

const ROUTE_ICON: Record<MeetingType, LucideIcon> = {
  dm: MessageCircle, call: Phone, email: Mail, meeting: MapPin,
  sample_sent: MapPin, note: MessageCircle, nudge: MessageCircle, reward: MessageCircle,
};
const LOG_LABEL: Partial<Record<MeetingType, string>> = { call: 'Log call', meeting: 'Log visit' };
const CHANNEL_TYPE: Record<DraftChannel, MeetingType> = { email: 'email', dm: 'dm', call: 'call' };

const btn = 'inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-clay-hairline px-2.5 text-xs font-medium text-clay-ink transition-transform duration-150 ease-out hover:border-clay-lavender active:scale-[0.97] disabled:opacity-50';

function Dots({ done }: { done: number }) {
  return (
    <span className="mr-1.5 inline-flex gap-[3px] align-middle" aria-hidden="true">
      {Array.from({ length: TOUCH_LIMIT }, (_, i) => (
        <span key={i} className={clsx('h-[7px] w-[7px] rounded-full', i < done ? 'bg-clay-lavender' : 'bg-clay-hairline')} />
      ))}
    </span>
  );
}

function LeadRow({ lead, today, contacts, busy, onLog, onPark }: {
  lead: Lead;
  today: string;
  contacts: Contact[];
  busy: boolean;
  onLog: (lead: Lead, type: MeetingType) => void;
  onPark: (lead: Lead, why: 'not_now' | 'not_fit') => void;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const { company, deal, route } = lead;
  const Icon = ROUTE_ICON[route.type];
  const finished = lead.next > TOUCH_LIMIT;
  const late = lead.stage === 'attempting' && lead.due < today ? `, due since ${day(lead.due)}` : lead.stage === 'attempting' ? ', due today' : '';

  return (
    <li className="border-t border-clay-hairline py-3 first:border-t-0" data-testid="lead-row">
      <div className="grid grid-cols-[30px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2 sm:grid-cols-[30px_minmax(0,1fr)_auto]">
        <CompanyLogo src={company.logo_url} name={company.name} id={company.id} size={30} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <Link href={`/companies?company=${company.id}`} className="max-w-full truncate text-sm font-semibold text-clay-ink hover:text-clay-lavender">{company.name}</Link>
            {lead.fit != null && <span className="rounded-md bg-clay-lavender/20 px-1.5 py-px text-[11px] text-clay-ink">fit {Math.round(lead.fit * 100)}%</span>}
            <span className={clsx('rounded-md px-1.5 py-px text-[11px]', lead.stage === 'new' ? 'bg-clay-surface text-clay-muted' : 'bg-clay-ochre/15 text-clay-ink')}>
              {lead.stage === 'new' ? 'New' : 'Attempting'}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-clay-muted">
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{route.label}{lead.lastTouch ? ` · last touch ${day(lead.lastTouch)}` : ''}</span>
          </p>
          <p className="mt-1 text-xs text-clay-body"><Dots done={lead.touches} />{touchLabel(lead.next, route)}{finished ? '' : late}</p>
        </div>
        <div className="relative col-start-2 flex shrink-0 items-center gap-1.5 sm:col-start-auto">
          {!finished && route.kind !== 'visit' && (
            <button type="button" className={btn} aria-expanded={open} onClick={() => setOpen(v => !v)}>Draft</button>
          )}
          {finished ? (
            <button type="button" className={clsx(btn, 'border-clay-lavender/60')} disabled={busy} onClick={() => onPark(lead, 'not_now')}>Not now</button>
          ) : (
            <button type="button" className={clsx(btn, 'border-clay-lavender/60')} disabled={busy} onClick={() => onLog(lead, route.type)}>
              {LOG_LABEL[route.type] ?? 'Log sent'}
            </button>
          )}
          <button type="button" className={clsx(btn, 'px-1.5')} aria-label={`More for ${company.name}`} aria-expanded={menu} onClick={() => setMenu(v => !v)}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-xl border border-clay-hairline bg-white py-1 text-sm shadow-lg dark:bg-clay-card">
              <button role="menuitem" type="button" className="block w-full px-3 py-2 text-left hover:bg-clay-surface" onClick={() => { setMenu(false); onPark(lead, 'not_now'); }}>Not now · back {day(notNowDate(today))}</button>
              <button role="menuitem" type="button" className="block w-full px-3 py-2 text-left hover:bg-clay-surface" onClick={() => { setMenu(false); onPark(lead, 'not_fit'); }}>Not a fit</button>
              <Link role="menuitem" href={`/companies?company=${company.id}`} className="block px-3 py-2 hover:bg-clay-surface">Open account</Link>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 rounded-lg bg-clay-surface p-3">
          <MessageDraft
            deal={deal}
            company={company}
            contacts={contacts}
            sendCount={lead.touches}
            onLog={channel => { setOpen(false); onLog(lead, CHANNEL_TYPE[channel]); }}
          />
        </div>
      )}
    </li>
  );
}

/** `embedded`: drawn inside This week's "do now" card, so it has no card of its own. */
export default function TodaysLeads({ leads, today, contacts, embedded = false }: { leads: Leads; today: string; contacts: Contact[]; embedded?: boolean }) {
  const { addMeeting, refresh, logActivity } = useCrm();
  const { addToast } = useToast();
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (leads.today.length === 0 && leads.waiting.length === 0) return null;

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

  const rows = showMore ? [...leads.today, ...leads.more] : leads.today;
  const firstWaiting = leads.waiting.slice(0, 2).map(w => w.company.name).join(', ');

  return (
    <section aria-labelledby="todays-leads" className={embedded ? undefined : 'rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card'} data-testid="todays-leads">
      <div className="flex flex-wrap items-baseline justify-between gap-1.5">
        <h2 id="todays-leads" className="text-sm font-semibold text-clay-ink">
          Today&apos;s leads <span className="font-normal text-clay-muted">· {leads.fresh} not yet contacted</span>
        </h2>
        <span className="text-xs text-clay-muted">Follow-ups first, then best fit</span>
      </div>

      {rows.length > 0 ? (
        <ul className="mt-1">
          {rows.map(lead => (
            <LeadRow key={lead.deal.id} lead={lead} today={today} contacts={contacts} busy={busy === lead.deal.id} onLog={log} onPark={park} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-clay-muted">Every lead you can reach is done for today.</p>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-clay-hairline pt-2.5 text-xs">
        {leads.waiting.length > 0 ? (
          <span className="flex items-center gap-1 text-clay-muted">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {leads.waiting.length} waiting for a way in ({firstWaiting}{leads.waiting.length > 2 ? '…' : ''}). Owner search runs Tue and Thu.
          </span>
        ) : <span />}
        {leads.more.length > 0 && (
          <button type="button" onClick={() => setShowMore(v => !v)} className="font-medium text-clay-lavender">
            {showMore ? 'Show fewer' : `Show ${leads.more.length} more`}
          </button>
        )}
      </div>
    </section>
  );
}
