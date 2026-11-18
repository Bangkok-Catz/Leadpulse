'use client';

import { useState } from 'react';
import { Contact, CONTACT_STATUS_LABELS, ContactIdentityQuality, ContactStatus, Company, OutreachLanguage } from '@/types/crm';
import { AtSign, Mail, MessageCircle, Phone, X, Edit2, Loader2, Check, Trash2, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useToast } from '@/components/ToastProvider';
import * as crm from '@/lib/crm';
import { useCrm } from '@/components/CrmProvider';
import { contactIdentityLabel, contactNameFieldCopy, OUTREACH_LANGUAGE_OPTIONS, outreachLanguageBadgeColor, outreachLanguageBasisLabel, outreachLanguageLabel } from '@/utils/contact-identity';
import InteractionThread from '@/components/InteractionThread';
import LayaBuyerSignalsSection from '@/components/LayaBuyerSignalsSection';
import LogInteractionModal from '@/components/LogInteractionModal';
import { Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { overlayVariants, panelVariants, tweenBase, tweenSlow } from '@/lib/motion';
import EntityAvatar from '@/components/EntityAvatar';
import ContactFields, { contactFieldsForSave, contactFieldsProblem } from '@/components/ContactFields';
import { CHANNEL_ORDER, channelLink, channelsOf, type ChannelKey } from '@/utils/contact-channels';

const CHANNEL_ICON: Record<ChannelKey, LucideIcon> = { line: MessageCircle, instagram: AtSign, whatsapp: MessageCircle, phone: Phone, email: Mail };
const CHANNEL_WORD: Record<ChannelKey, string> = { line: 'LINE', instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Phone', email: 'Email' };

const statusOptions: ContactStatus[] = ['uncontacted', 'active', 'replied', 'not_interested', 'no_response', 'parked'];

interface ContactDetailProps {
  contact: Contact;
  onClose: () => void;
  onSaved: () => void;
  companies: Company[];
}

export default function ContactDetail({ contact, onClose, onSaved, companies }: ContactDetailProps) {
  const { addToast } = useToast();
  const { deleteEntity, meetings = [], contacts = [], deals = [], addMeeting } = useCrm();
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [editData, setEditData] = useState({
    name: contact.name,
    email: contact.email || '',
    phone: contact.phone || '',
    phone_second: contact.phone_second || '',
    line: contact.line || '',
    instagram: contact.instagram || '',
    whatsapp: contact.whatsapp || '',
    job_title: contact.job_title || '',
    company_id: contact.company_id || '',
    status: contact.status,
    identity_quality: (contact.identity_quality ?? 'unknown') as ContactIdentityQuality,
    outreach_language: contact.outreach_language ?? 'autodetect',
    notes: contact.notes || '',
  });
  const contactNameCopy = contactNameFieldCopy(editData.identity_quality);
  const [triedSave, setTriedSave] = useState(false);
  const channels = channelsOf(contact);

  const handleSave = async () => {
    const problem = contactFieldsProblem(editData);
    if (problem) {
      setTriedSave(true);
      setError(problem);
      return;
    }
    setTriedSave(false);
    setSaving(true);
    setError(null);
    try {
      const updated = await crm.updateContact(contact.id, contactFieldsForSave({ ...editData }));
      // Re-sync local field so the saved values show immediately
      setEditData({
        name: updated.name,
        email: updated.email || '',
        phone: updated.phone || '',
        line: updated.line || '',
        instagram: updated.instagram || '',
        whatsapp: updated.whatsapp || '',
        phone_second: updated.phone_second || '',
        job_title: updated.job_title || '',
        company_id: updated.company_id || '',
        status: updated.status,
        identity_quality: updated.identity_quality || 'unknown',
        outreach_language: updated.outreach_language ?? 'autodetect',
        notes: updated.notes || '',
      });
      setEditing(false);
      setSaved(true);
      onSaved();
      addToast('Contact saved!');
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      console.error('Failed to update contact:', err);
      setError('Could not save: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const contactInteractions = meetings
    .filter(m =>
      (m.contact_ids || []).includes(contact.id) ||
      (contact.company_id && m.company_id === contact.company_id && !(m.contact_ids || []).includes(contact.id))
    )
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <>
    <div className="fixed inset-0 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <motion.div
        className="absolute inset-0 bg-black/50"
        variants={overlayVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={tweenBase}
        onClick={onClose}
      />
      <motion.div
        className={clsx(
          'relative bg-white dark:bg-clay-card w-full md:max-w-md md:rounded-2xl rounded-t-2xl p-6 max-h-[80vh] overflow-y-auto',
          saving ? 'opacity-80' : saved ? 'ring-2 ring-clay-success/40' : ''
        )}
        variants={panelVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={tweenSlow}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 gap-2">
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-1">
            <EntityAvatar
              kind="person"
              name={editing ? editData.name || contact.name : contact.name}
              id={contact.id}
              size={48}
            />
            {editing ? (
              <input
                type="text"
                aria-label={contactNameCopy.label}
                placeholder={contactNameCopy.placeholder}
                value={editData.name}
                onChange={e => setEditData(prev => ({ ...prev, name: e.target.value }))}
                className="text-lg font-semibold text-clay-ink bg-transparent border-b border-clay-ink outline-none flex-1 min-w-0"
              />
            ) : (
              <h2 className="text-lg font-semibold text-clay-ink truncate">{contact.name}</h2>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {editing && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="p-2 text-clay-success active:opacity-70 transition-all disabled:opacity-50"
                aria-label="Save contact"
              >
                {saving ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <span className={clsx('inline-flex transition-transform', saved && 'scale-110')}>
                    <Check className={clsx('w-5 h-5 transition-colors', saved ? 'text-clay-success' : '')} />
                  </span>
                )}
              </button>
            )}
            <button onClick={() => setEditing(!editing)} className="p-2 text-clay-muted active:opacity-70" aria-label="Edit contact">
              <Edit2 className="w-5 h-5" />
            </button>
            <button onClick={() => setConfirmArchive(true)} className="p-2 text-clay-muted-soft active:opacity-70 hover:text-clay-error transition-colors" aria-label="Archive contact">
              <Trash2 className="w-5 h-5" />
            </button>
            <button onClick={onClose} className="p-2 text-clay-muted active:opacity-70">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {saving && (
          <div className="mb-4 flex items-center gap-2 text-sm text-clay-success animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin" />
            Saving…
          </div>
        )}
        {saved && !saving && (
          <div className="mb-4 flex items-center gap-2 text-sm text-clay-success animate-[pulse-dot_1s_ease-in-out]">
            <Check className="w-4 h-4" />
            Saved
          </div>
        )}
        {error && !saving && (
          <div className="mb-4 text-sm text-clay-error">{error}</div>
        )}

        <div className="space-y-3 text-sm">
          {editing ? (
            <ContactFields
              values={editData}
              onChange={patch => setEditData(prev => ({ ...prev, ...patch }))}
              showProblems={triedSave}
              hideName
            />
          ) : (
            <>
              {CHANNEL_ORDER.map(key => {
                const value = channels[key];
                const href = channelLink(key, value);
                const Icon = CHANNEL_ICON[key];
                return (
                  <div key={key} className="flex items-center gap-2 text-clay-body">
                    <Icon className="w-4 h-4 shrink-0 text-clay-muted" aria-hidden="true" />
                    <span className="w-20 shrink-0 text-xs text-clay-muted">{CHANNEL_WORD[key]}</span>
                    {value
                      ? href
                        ? <a href={href} target={key === 'phone' || key === 'email' ? undefined : '_blank'} rel="noreferrer" className="truncate text-clay-ink underline decoration-clay-hairline underline-offset-2 hover:decoration-clay-lavender">{key === 'instagram' ? `@${value}` : value}</a>
                        : <span className="truncate">{value}</span>
                      : <span className="text-clay-muted-soft">—</span>}
                  </div>
                );
              })}
              {contact.phone_second && (
                <div className="flex items-center gap-2 text-clay-body">
                  <Phone className="w-4 h-4 shrink-0 text-clay-muted" aria-hidden="true" />
                  <span className="w-20 shrink-0 text-xs text-clay-muted">Alternate</span>
                  <span className="truncate">{contact.phone_second}</span>
                </div>
              )}
              <div className="text-clay-body"><span className="text-clay-muted">Role: </span>{contact.job_title || '—'}</div>
            </>
          )}

          <div className="text-clay-body">
            <span className="text-clay-muted">Status: </span>
            {editing ? (
              <select
                value={editData.status}
                onChange={e => setEditData(prev => ({ ...prev, status: e.target.value as ContactStatus }))}
                className="inline-block px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
              >
                {statusOptions.map(s => <option key={s} value={s}>{CONTACT_STATUS_LABELS[s]}</option>)}
              </select>
            ) : (
              <span className="px-2 py-0.5 bg-clay-card rounded text-xs">{CONTACT_STATUS_LABELS[contact.status]}</span>
            )}
          </div>

          {!editing && (
            <p className="text-clay-body">
              <span className="text-clay-muted">Who: </span>
              {contactIdentityLabel(contact.identity_quality)}
              {(contact.identity_quality ?? 'unknown') === 'unknown' && <span className="ml-1 text-xs text-clay-warning-strong dark:text-clay-ochre">· not said yet: edit to set it</span>}
            </p>
          )}

          <label className="block text-clay-body">
            Outreach language
            {editing ? (
              <select
                value={editData.outreach_language}
                onChange={e => setEditData(prev => ({ ...prev, outreach_language: e.target.value as OutreachLanguage }))}
                className="block w-full mt-1 px-2 py-2 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
              >
                {OUTREACH_LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : (
              <span className="block mt-1 text-clay-body">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${outreachLanguageBadgeColor(contact.outreach_language)}`}>
                  {outreachLanguageLabel(contact.outreach_language)}
                </span>
                <span className="ml-2 text-xs text-clay-muted">
                  {outreachLanguageBasisLabel(contact.outreach_language_basis)}
                </span>
              </span>
            )}
          </label>

          <div className="text-clay-body">
            <span className="text-clay-muted">Company: </span>
            {editing ? (
              <select
                value={editData.company_id || ''}
                onChange={e => setEditData(prev => ({ ...prev, company_id: e.target.value }))}
                className="inline-block px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
              >
                <option value="">— None —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <span className="text-clay-body">
                {contact.company_id
                  ? companies.find(c => c.id === contact.company_id)?.name || 'Unknown'
                  : '—'}
              </span>
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">Notes:</span>
            {editing ? (
              <textarea
                value={editData.notes}
                onChange={e => setEditData(prev => ({ ...prev, notes: e.target.value }))}
                rows={4}
                className="w-full mt-1 px-2 py-2 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card resize-none"
                placeholder="Add notes..."
              />
            ) : (
              <div className="bg-clay-surface rounded-lg p-3 text-clay-body text-xs leading-relaxed mt-1">
                {contact.notes || 'No notes yet'}
              </div>
            )}

            </div>

            {/* Laya buyer signals — on-demand scorer per open deal carrying a verbatim buyer reply */}
            <LayaBuyerSignalsSection
              deals={deals.filter(d => d.contact_ids.includes(contact.id))}
              companyFor={deal => companies.find(c => c.id === deal.company_id)}
            />

            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="zams-display text-sm text-clay-ink">Interactions</h3>
                <button
                  type="button"
                  onClick={() => setLogOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-clay-ink text-clay-canvas text-xs font-medium active:opacity-85 transition-opacity min-h-[36px]"
                >
                  <Plus className="w-3.5 h-3.5" /> New interaction
                </button>
              </div>
              <InteractionThread
                meetings={contactInteractions}
                allContacts={contacts}
                deals={deals}
                companies={companies}
              />
            </div>

          {confirmArchive && (
            <div className="mt-4 rounded-xl border border-clay-hairline bg-clay-surface p-4">
              <div className="flex gap-3"><span className="text-2xl">🗑️</span><div><p className="font-semibold text-clay-ink">Archive this contact?</p><p className="text-xs text-clay-muted mt-1">{contact.name} will be hidden from lists and the company view. You can undo this under Recent changes on This week.</p></div></div>
              <div className="grid grid-cols-2 gap-2 mt-3"><button onClick={() => { setConfirmArchive(false); setSaving(true); deleteEntity('contact', contact.id, contact.name).then(() => { setSaving(false); addToast('Contact archived'); onClose(); }).catch(err => { setSaving(false); setError('Could not archive: ' + (err.message || 'Unknown error')); }); }} className="px-3 py-2.5 bg-clay-error text-white text-sm font-medium rounded-lg">Archive</button><button onClick={() => setConfirmArchive(false)} className="px-3 py-2.5 bg-clay-card text-clay-ink text-sm font-medium rounded-lg">Cancel</button></div>
            </div>
          )}
        </div>
      </motion.div>
    </div>

    <LogInteractionModal
      isOpen={logOpen}
      onClose={() => setLogOpen(false)}
      onSave={async (meeting) => { await addMeeting(meeting); }}
      deals={deals}
      contacts={contacts}
      companies={companies}
      initialContactIds={[contact.id]}
      initialCompanyId={contact.company_id || undefined}
    />
    </>
  );
}
