'use client';

// ─── Deal panel: draft a message ───
// A short starting draft for the situation the deal is in, worded after Pat's message
// library. Pat fills the [blanks], edits it, copies it or opens his mail app, sends it
// himself, then logs it in one tap. Nothing is sent from here.

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Copy, Mail, Phone } from 'lucide-react';
import type { Company, Contact, Deal } from '@/types/crm';
import { useToast } from '@/components/ToastProvider';
import { isCompanyRoute } from '@/utils/contact-identity';
import { getWorkflowAction } from '@/utils/deal-workflow';
import {
  NUDGE_LIMIT,
  TEMPLATE_KINDS,
  TEMPLATE_LABEL,
  USES_APPLICATION,
  buildDraft,
  defaultDraftLanguage,
  defaultTemplateKind,
  hasBlanks,
  isNudge,
  isTradeAccount,
  nudgeStep,
  segmentPainFor,
  type DraftLanguage,
  type TemplateKind,
} from '@/utils/message-templates';

export type DraftChannel = 'email' | 'dm' | 'call';

const chip = (selected: boolean) => clsx(
  'inline-flex h-8 items-center rounded-lg border px-2.5 text-xs transition-colors',
  selected ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-body hover:border-clay-ink/30',
);
const action = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-clay-hairline px-3 text-xs font-medium text-clay-ink transition-transform duration-150 ease-out hover:border-clay-lavender active:scale-[0.97]';

export default function MessageDraft({
  deal,
  company,
  contacts,
  sendCount = 0,
  onLog,
  onSaveApplication,
  logChannel,
}: {
  deal: Deal;
  company?: Company;
  /** every contact; the deal's people and the account's channels are picked from it */
  contacts: Contact[];
  /** unanswered sends on the deal so far; picks first approach or which nudge */
  sendCount?: number;
  /** open the log form for this deal, set to the channel used and titled after the draft */
  onLog: (channel: DraftChannel, title: string) => void;
  /** keep what Pat typed as the account's "what they make", so the next draft starts with it */
  onSaveApplication?: (value: string) => void;
  /** how "Sent it, log" logs the send; without it, email when there is an address, else a message */
  logChannel?: DraftChannel;
}) {
  const { addToast } = useToast();

  // Who the message goes to: a person on the deal if there is one; channels may come from
  // the account's routes (info@, front desk) when the person has none.
  const { person, email, phone } = useMemo(() => {
    const onDeal = contacts.filter(c => (deal.contact_ids ?? []).includes(c.id));
    const atCompany = company ? contacts.filter(c => c.company_id === company.id) : [];
    const person = onDeal.find(c => !isCompanyRoute(c)) ?? null;
    const pool = [...(person ? [person] : []), ...onDeal, ...atCompany];
    return {
      person,
      email: pool.find(c => c.email?.trim())?.email?.trim() ?? null,
      phone: pool.find(c => c.phone?.trim())?.phone?.trim() ?? null,
    };
  }, [contacts, deal.contact_ids, company]);

  const pain = useMemo(() => segmentPainFor(company), [company]);
  const trade = useMemo(() => isTradeAccount(company), [company]);
  const [kind, setKind] = useState<TemplateKind>(() => defaultTemplateKind({
    lane: getWorkflowAction(deal), companyStatus: company?.status, sampleStatus: deal.sample_status, sendCount,
  }));
  const [language, setLanguage] = useState<DraftLanguage>(() => defaultDraftLanguage({
    contactLanguage: person?.outreach_language, buyerReply: deal.buyer_reply, contactName: person?.name, contactPhone: phone, company,
  }));
  const [application, setApplication] = useState(company?.what_they_make ?? '');
  // Which of the four nudges: from the unanswered sends, until Pat picks another.
  const [step, setStep] = useState(() => nudgeStep(sendCount));
  // null = show the generated draft; a string = Pat's edit, kept until he switches template or language.
  const [edited, setEdited] = useState<string | null>(null);

  const draft = useMemo(
    () => buildDraft({ kind, language, companyName: company?.name ?? deal.client ?? '', contactName: person?.name, product: deal.product, application, trade, sendCount: step }),
    [kind, language, company, deal.client, deal.product, person, application, trade, step],
  );
  const body = edited ?? draft.body;
  const title = isNudge(kind) ? `Nudge ${step} of ${NUDGE_LIMIT} sent` : `${TEMPLATE_LABEL[kind]} message sent`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      addToast('Draft copied');
    } catch {
      addToast('Could not copy. Select the text and copy it by hand.', 'error');
    }
  };

  return (
    <div className="space-y-3" data-testid="message-draft">
      <p className="text-xs text-clay-muted">
        <span className="font-medium text-clay-body">{pain.segment}:</span> {pain.pain}
      </p>

      <div className="flex items-center gap-1.5">
        <select
          aria-label="Situation"
          value={kind}
          onChange={event => { setKind(event.target.value as TemplateKind); setEdited(null); }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-clay-hairline bg-transparent px-2 text-xs text-clay-ink focus:border-clay-ink/40 focus:outline-none"
        >
          {TEMPLATE_KINDS.map(k => (
            <option key={k} value={k}>{TEMPLATE_LABEL[k]}</option>
          ))}
        </select>
        <div role="radiogroup" aria-label="Language" className="flex gap-1.5">
          {(['english', 'thai'] as const).map(l => (
            <button key={l} type="button" role="radio" aria-checked={language === l} onClick={() => { setLanguage(l); setEdited(null); }} className={chip(language === l)}>
              {l === 'english' ? 'EN' : 'ไทย'}
            </button>
          ))}
        </div>
      </div>

      {isNudge(kind) && (
        <div role="radiogroup" aria-label="Which nudge" className="flex items-center gap-1.5">
          <span className="text-xs text-clay-muted">Nudge</span>
          {Array.from({ length: NUDGE_LIMIT }, (_, i) => i + 1).map(n => (
            <button key={n} type="button" role="radio" aria-checked={step === n} aria-label={`Nudge ${n} of ${NUDGE_LIMIT}`} onClick={() => { setStep(n); setEdited(null); }} className={chip(step === n)}>
              {n}
            </button>
          ))}
          <span className="text-xs text-clay-muted">{['reminder', 'new reason', 'yes or later', 'calm exit'][step - 1]}</span>
        </div>
      )}

      {USES_APPLICATION.has(kind) && (
        <input
          aria-label="Their menu item or recipe"
          placeholder={trade ? 'What they carry, e.g. Elle & Vire butter (saved to the account)' : 'What they make, e.g. croissants (saved to the account)'}
          value={application}
          onChange={event => { setApplication(event.target.value); setEdited(null); }}
          onBlur={() => { if (company && application.trim() !== (company.what_they_make ?? '').trim()) onSaveApplication?.(application.trim()); }}
          className="h-8 w-full rounded-lg border border-clay-hairline bg-transparent px-2.5 text-xs text-clay-ink placeholder:text-clay-muted focus:border-clay-ink/40 focus:outline-none"
        />
      )}

      <textarea
        aria-label="Message draft"
        value={body}
        onChange={event => setEdited(event.target.value)}
        rows={6}
        className="w-full resize-y rounded-xl border border-clay-hairline bg-transparent px-3.5 py-3 text-sm leading-relaxed text-clay-ink focus:border-clay-ink/40 focus:outline-none focus:ring-2 focus:ring-clay-ink/10"
      />

      {hasBlanks(body) && (
        <p data-testid="draft-blanks" className="text-xs text-clay-ochre-strong">Fill in the [blanks] before you send.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copy()} className={action}>
          <Copy className="h-3.5 w-3.5" /> Copy
        </button>
        {email && (
          <a href={`mailto:${email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(body)}`} className={action} aria-label={`Open an email to ${email}`}>
            <Mail className="h-3.5 w-3.5" /> Email
          </a>
        )}
        {phone && (
          <a href={`tel:${phone.replace(/[^+\d]/g, '')}`} className={action} aria-label={`Call ${phone}`}>
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        )}
        <button
          type="button"
          onClick={() => onLog(logChannel ?? (email ? 'email' : 'dm'), title)}
          className="ml-auto inline-flex h-9 items-center rounded-lg bg-clay-ink px-3.5 text-xs font-medium text-clay-canvas transition-transform duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
        >
          Sent it, log
        </button>
      </div>
      <p className="text-[11px] text-clay-muted">Nothing is sent from here. Copy the draft or open your mail app, send it yourself, then log it.</p>
    </div>
  );
}
