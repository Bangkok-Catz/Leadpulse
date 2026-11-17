'use client';

// ─── The fields every contact form shares ───
// Who the contact is (asked, never assumed), their name and role, and one box per channel:
// LINE, Instagram, WhatsApp, phone, alternate phone, email. Under the phone and LINE boxes the
// checks in utils/contact-channels.ts say what looks wrong, with a one-tap fix where it is clear.
// Used by New contact, the account panel's Add, and the contact panel's edit.

import { useId } from 'react';
import clsx from 'clsx';
import type { ContactIdentityQuality } from '@/types/crm';
import { contactNameFieldCopy } from '@/utils/contact-identity';
import { IDENTITY_CHOICES, identityProblem, instagramHandle, lineHint, phoneHint, type FieldHint } from '@/utils/contact-channels';

export interface ContactFieldValues {
  name: string;
  identity_quality: ContactIdentityQuality;
  job_title: string;
  phone: string;
  phone_second: string;
  line: string;
  instagram: string;
  whatsapp: string;
  email: string;
}

export const EMPTY_CONTACT_FIELDS: ContactFieldValues = {
  name: '', identity_quality: 'unknown', job_title: '', phone: '', phone_second: '', line: '', instagram: '', whatsapp: '', email: '',
};

/** The form values as saved: an Instagram handle without @ or a link around it. */
export function contactFieldsForSave<T extends Partial<ContactFieldValues>>(values: T): T {
  const ig = values.instagram?.trim() ?? '';
  return { ...values, instagram: ig ? instagramHandle(ig) ?? ig : '' };
}

/** Why the form can't be saved yet, or null. */
export function contactFieldsProblem(values: Pick<ContactFieldValues, 'identity_quality' | 'name'>): string | null {
  return identityProblem(values.identity_quality) ?? (values.name.trim() ? null : 'A name or label is needed');
}

const input = 'w-full rounded-lg border border-clay-hairline bg-white px-3 py-2.5 text-base text-clay-ink placeholder:text-clay-muted-soft focus:outline-none focus:ring-2 focus:ring-clay-lavender/60 dark:bg-clay-card';
const labelText = 'mb-1 block text-xs font-medium text-clay-muted';

function Box({ label, value, onChange, placeholder, type = 'text', prefix, hint, onFix }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  prefix?: string;
  hint?: FieldHint | null;
  onFix?: (fix: NonNullable<FieldHint['fix']>) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelText}>{label}</label>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-clay-muted-soft" aria-hidden="true">{prefix}</span>}
        <input
          id={id}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={hint ? true : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={clsx(input, prefix && 'pl-7', hint && 'border-clay-warning/70')}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-clay-warning-strong dark:text-clay-ochre">
          {hint.message}
          {hint.fix && hint.fixLabel && onFix && (
            <button
              type="button"
              onClick={() => onFix(hint.fix!)}
              className="rounded-md border border-clay-hairline bg-white px-2 py-0.5 font-medium text-clay-ink hover:border-clay-lavender dark:bg-clay-card"
            >
              {hint.fixLabel}
            </button>
          )}
        </p>
      )}
    </div>
  );
}

export default function ContactFields({ values, onChange, showProblems = false, hideName = false }: {
  values: ContactFieldValues;
  onChange: (patch: Partial<ContactFieldValues>) => void;
  /** say what is missing (after a save was tried) */
  showProblems?: boolean;
  /** the name is edited elsewhere (the contact panel's header) */
  hideName?: boolean;
}) {
  const nameCopy = contactNameFieldCopy(values.identity_quality);
  const who = identityProblem(values.identity_quality);
  const fix = (patch: NonNullable<FieldHint['fix']>) => onChange(patch as Partial<ContactFieldValues>);
  return (
    <div className="space-y-3" data-testid="contact-fields">
      <fieldset>
        <legend className={labelText}>Who is this?</legend>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Who is this?">
          {IDENTITY_CHOICES.map(choice => {
            const on = values.identity_quality === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={on}
                title={choice.hint}
                onClick={() => onChange({ identity_quality: choice.value })}
                className={clsx(
                  'min-h-10 rounded-lg border px-2 py-1.5 text-xs font-medium leading-tight transition-colors',
                  on ? 'border-clay-lavender/70 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline bg-white text-clay-body hover:border-clay-ink/30 dark:bg-clay-card',
                )}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        {who && (showProblems || values.name.trim()) && (
          <p className={clsx('mt-1 text-xs', showProblems ? 'text-clay-error' : 'text-clay-muted')} role={showProblems ? 'alert' : undefined}>{who}</p>
        )}
      </fieldset>

      {!hideName && (
        <Box label={nameCopy.label} value={values.name} onChange={name => onChange({ name })} placeholder={nameCopy.placeholder} />
      )}
      {values.identity_quality !== 'company_route' && (
        <Box label="Role" value={values.job_title} onChange={job_title => onChange({ job_title })} placeholder="e.g., Owner, Head chef, Purchasing" />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Box label="LINE" value={values.line} onChange={line => onChange({ line })} placeholder="@lineid or lin.ee link"
          hint={lineHint(values.line, values)} onFix={fix} />
        <Box label="Instagram" value={values.instagram} onChange={instagram => onChange({ instagram })} placeholder="handle" prefix="@" />
        <Box label="WhatsApp" value={values.whatsapp} onChange={whatsapp => onChange({ whatsapp })} placeholder="+65 9766 9860" type="tel" />
        <Box label="Phone" value={values.phone} onChange={phone => onChange({ phone })} placeholder="081 234 5678" type="tel"
          hint={phoneHint(values.phone, values)} onFix={fix} />
        <Box label="Alternate phone" value={values.phone_second} onChange={phone_second => onChange({ phone_second })} placeholder="Optional" type="tel" />
        <Box label="Email" value={values.email} onChange={email => onChange({ email })} placeholder="name@shop.com" type="email" />
      </div>
    </div>
  );
}
