'use client';

import { useEffect, useEffectEvent, useMemo, useState, useRef } from 'react';
import { Company, COMPANY_STATUS_LABELS, CompanyStatus, Contact, STAGE_LABELS } from '@/types/crm';
import Link from 'next/link';
import { Briefcase, Building2, CalendarClock, Globe, X, Edit2, Loader2, Check, UserPlus, Trash2, Gift, GitFork, ShoppingCart, ChevronDown, ChevronRight, DoorClosed, DoorOpen, Lightbulb, MoreHorizontal, Plus, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { useToast } from '@/components/ToastProvider';
import { useCrm } from '@/components/CrmProvider';
import * as crm from '@/lib/crm';
import { resizeImageToSquare, validateLogoFile } from '@/lib/image';
import CompanyLogo from '@/components/CompanyLogo';
import WebsiteFill from '@/components/WebsiteFill';
import EntityAvatar from '@/components/EntityAvatar';
import LayaBuyerSignalsSection from '@/components/LayaBuyerSignalsSection';
import { FitCard, SourceChip, WaitingForYou } from '@/components/AccountProfile';
import { ROLE_LABELS, siteHost, dealLabel, fitChipLabel, nextStep, roleOf, rolePatch, suggestDecider, type PersonRole, openDeals, readableNotes, sourcesFor, type CompanyFit, type EvidenceRow } from '@/utils/account-profile';
import LayaLeadTierBadge from '@/components/LayaLeadTierBadge';
import { bestLeadSignal, dealsWithVerbatimBuyerReply } from '@/utils/lead-scoring';
import type { EnrichmentProposal } from '@/utils/proposals';
import { useCloseDown } from '@/components/useCloseDown';
import ContactFields, { EMPTY_CONTACT_FIELDS, contactFieldsForSave, contactFieldsProblem, type ContactFieldValues } from '@/components/ContactFields';
import { CHANNEL_ORDER, channelsOf, type ChannelKey } from '@/utils/contact-channels';
import { isClosedDown } from '@/utils/closed-down';
import ContactDetail from '@/components/ContactDetail';
import InteractionThread from '@/components/InteractionThread';
import LogInteractionModal from '@/components/LogInteractionModal';
import { motion } from 'framer-motion';
import { overlayVariants, panelVariants, tweenBase, tweenSlow } from '@/lib/motion';
import { AHS_TIERS } from '@/utils/accountHealth';
import { isCompanyRoute } from '@/utils/contact-identity';
import { businessDateKey, businessDaysBetween, isCalendarDateKey } from '@/utils/business-time';
import { formatScheduleDate } from '@/utils/deal-schedule';
import { deriveRetentionDueSignals, existingRetentionReferenceDate } from '@/utils/followup-policy';
import { deriveMapStatus } from '@/utils/stakeholder-map';
import { ACQUISITION_SOURCE_OPTIONS, acquisitionLabel, normalizeAcquisition } from '@/utils/acquisition-source';
import { branchLabel } from '@/utils/company-duplicates';

// 'closed' is set by the Closed down action (it also parks the open deals), so the dropdown
// offers it only to an account that is already closed.
const ROUTE_WORD: Record<ChannelKey, string> = { line: 'LINE', instagram: 'Instagram', whatsapp: 'WhatsApp', phone: 'Phone', email: 'Email' };

const statusOptions: CompanyStatus[] = ['prospect', 'active_customer', 'inactive', 'lost'];

const ROLE_STYLE: Record<PersonRole, string> = {
  decides: 'bg-clay-lavender/25 text-clay-ink',
  champion: 'bg-clay-mint/30 text-clay-ink',
  blocker: 'bg-clay-error/15 text-clay-error',
};

/** One "label · value" line in Details; only rendered when there is a value. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
      <span className="text-clay-muted">{label}</span>
      <span className="flex flex-wrap items-center text-clay-body">{children}</span>
    </div>
  );
}

interface CompanyDetailProps {
  company: Company;
  onClose: () => void;
  onSaved: () => void;
  contacts: Contact[];
  companyContacts: Contact[];
  /** Opens another account in this panel (its main account or a branch). */
  onOpenCompany?: (id: string) => void;
}

export default function CompanyDetail({ company, onClose, onSaved, contacts, companyContacts, onOpenCompany }: CompanyDetailProps) {
  const { addToast } = useToast();
  const { createContact, refresh, deleteEntity, meetings, deals = [], companies = [], addMeeting, accountEvents = [], accountEventsUnavailable } = useCrm();
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const openContact = companyContacts.find((c) => c.id === openContactId) ?? null;
  // Routes (info@, general LINE, front desk) are how to reach the account, not people.
  const people = companyContacts.filter((c) => !isCompanyRoute(c));
  const routes = companyContacts.filter(isCompanyRoute);

  // Customer health and next check-in, same derivation as This week's check-ins.
  const today = businessDateKey();
  const health = useMemo(() => deriveRetentionDueSignals({
    today,
    retentionCalculationDate: existingRetentionReferenceDate(),
    companies: [company],
    deals,
    meetings,
    accountEvents,
    accountEventsUnavailable,
  })[0] ?? null, [today, company, deals, meetings, accountEvents, accountEventsUnavailable]);

  // Everything logged against this account or any of its people, newest first.
  const accountInteractions = useMemo(() => {
    const contactIds = new Set(companyContacts.map((c) => c.id));
    return meetings
      .filter((m) => m.company_id === company.id || (m.contact_ids || []).some((id) => contactIds.has(id)))
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [meetings, company.id, companyContacts]);
  // Laya's fit grade, where saved values came from, and proposals waiting for Pat.
  const [fit, setFit] = useState<CompanyFit | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [waiting, setWaiting] = useState<EnrichmentProposal[]>([]);
  const [logoProposal, setLogoProposal] = useState<string | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      crm.getCompanyFit(company.id), crm.getCompanyEvidence(company.id), crm.getPendingProposals(company.id), crm.getLogoProposals(),
    ]).then(([fitResult, evidenceResult, waitingResult, logoResult]) => {
      if (cancelled) return;
      // Each part is optional: a failed load leaves that part out rather than blocking the panel.
      setFit(fitResult.status === 'fulfilled' ? fitResult.value : null);
      setEvidence(evidenceResult.status === 'fulfilled' ? evidenceResult.value : []);
      setWaiting(waitingResult.status === 'fulfilled' ? waitingResult.value : []);
      setLogoProposal(logoResult.status === 'fulfilled' ? logoResult.value.get(company.id) ?? null : null);
    });
    return () => { cancelled = true; };
  }, [company.id, profileVersion]);
  const sourceOf = useMemo(() => sourcesFor(evidence), [evidence]);
  const contactSource = (contact: Contact) =>
    sourceOf('contact', contact.id, 'name', contact.name)
    ?? sourceOf('contact', contact.id, 'line', contact.line)
    ?? sourceOf('contact', contact.id, 'email', contact.email)
    ?? sourceOf('contact', contact.id, 'phone', contact.phone);

  // Layout state: the ⋯ menu, folded Details, long notes, and the full activity list.
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [roleSaving, setRoleSaving] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const suggestion = suggestDecider(company, people);
  // Roles live on people: who decides, who champions, who blocks (same fields the old map used).
  const setRole = async (contactId: string, role: PersonRole | null) => {
    setRoleSaving(true);
    try {
      await crm.updateCompany(company.id, rolePatch(company, contactId, role));
      setRoleFor(null);
      onSaved();
      refresh();
      addToast(role ? `Set as ${ROLE_LABELS[role].toLowerCase()}` : 'Role cleared');
    } catch (err) {
      addToast('Could not save the role: ' + (err instanceof Error ? err.message : 'error'));
    } finally {
      setRoleSaving(false);
    }
  };
  const companyDeals = useMemo(() => deals.filter((d) => d.company_id === company.id), [deals, company.id]);
  const liveDeals = useMemo(() => openDeals(companyDeals), [companyDeals]);
  const step = useMemo(() => nextStep(companyDeals, today), [companyDeals, today]);
  const leadSignal = useMemo(() => bestLeadSignal(companyDeals), [companyDeals]);
  const buyerReplyDeals = useMemo(() => dealsWithVerbatimBuyerReply(companyDeals).length, [companyDeals]);
  const isCustomer = company.status === 'active_customer' || company.status === 'inactive';
  const notes = readableNotes(company.notes);
  // "Branch of" from Possible duplicates: this account's main account, and its own branches.
  const parentCompany = company.parent_company_id ? companies.find((c) => c.id === company.parent_company_id) ?? null : null;
  const branches = companies.filter((c) => c.parent_company_id === company.id);
  const linkChip = 'inline-flex items-center gap-1 rounded bg-clay-lavender/20 px-1.5 py-0.5 text-[11px] font-medium text-clay-ink';

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const { closeDown, reopen, busy: closeBusy } = useCloseDown();
  const [showLogSale, setShowLogSale] = useState(false);
  const [saleSaving, setSaleSaving] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [newSale, setNewSale] = useState({ amount: '', date: new Date().toISOString().split('T')[0], product: '' });

  // One path for a picked, pasted or dropped image: squared, stored, saved on the account.
  const uploadLogoFile = async (file: File) => {
    const validationError = validateLogoFile(file);
    if (validationError) {
      setLogoError(validationError);
      return;
    }
    setLogoSaving(true);
    setLogoError(null);
    try {
      const resized = await resizeImageToSquare(file);
      const url = await crm.uploadCompanyLogo(company.id, resized);
      await crm.updateCompany(company.id, { logo_url: url });
      onSaved();
      addToast('Logo saved');
    } catch (err) {
      console.error('Logo upload failed:', err);
      setLogoError('Could not upload: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLogoSaving(false);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (logoInputRef.current) logoInputRef.current.value = '';
    if (file) void uploadLogoFile(file);
  };

  // An image pasted (⌘V) while the panel is open becomes the logo, unless it went into a field.
  const onPastedImage = useEffectEvent((file: File) => { void uploadLogoFile(file); });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      onPastedImage(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  // Dragging an image over the panel outlines the logo tile; dropping it anywhere on the panel saves it.
  const [draggingImage, setDraggingImage] = useState(false);
  const carriesFile = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dragHandlers = {
    onDragEnter: (e: React.DragEvent) => { if (carriesFile(e)) { e.preventDefault(); setDraggingImage(true); } },
    onDragOver: (e: React.DragEvent) => { if (carriesFile(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraggingImage(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!carriesFile(e)) return;
      e.preventDefault();
      setDraggingImage(false);
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
      if (file) void uploadLogoFile(file);
      else setLogoError('Drop an image file to use it as the logo.');
    },
  };

  // A logo found on their website waits for Use logo / Not theirs.
  const [findingLogo, setFindingLogo] = useState(false);
  const handleFindLogo = async () => {
    setFindingLogo(true);
    setLogoError(null);
    try {
      const url = await crm.findLogoOnSite(company.id);
      setLogoProposal(url);
      addToast(url ? 'Found a logo: it waits for you below' : 'No usable logo on their site');
    } catch (err) {
      setLogoError('Could not look: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setFindingLogo(false);
    }
  };
  const decideLogoProposal = async (action: 'use' | 'reject') => {
    if (action === 'use') await crm.acceptLogoProposal(company.id);
    else await crm.rejectLogoProposal(company.id);
    setLogoProposal(null);
    if (action === 'use') onSaved();
  };

  const handleRemoveLogo = async () => {
    setLogoSaving(true);
    setLogoError(null);
    try {
      if (company.logo_url) await crm.deleteCompanyLogo(company.id);
      await crm.updateCompany(company.id, { logo_url: null });
      onSaved();
      addToast('Logo removed');
    } catch (err: any) {
      console.error('Logo remove failed:', err);
      setLogoError('Could not remove: ' + (err.message || 'Unknown error'));
    } finally {
      setLogoSaving(false);
    }
  };
  const handleLogSale = async () => {
    const amountNum = parseFloat(newSale.amount.replace(/,/g, ''));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setSaleError('Enter the order amount in baht.');
      return;
    }
    if (!newSale.date) {
      setSaleError('Pick the order date.');
      return;
    }
    setSaleSaving(true);
    setSaleError(null);
    try {
      await crm.createAccountEvent(
        {
          company_id: company.id,
          event_date: newSale.date,
          amount: amountNum,
          product_line: newSale.product.trim() || null,
          order_id: null,
        },
        'app_manual',
      );
      setShowLogSale(false);
      setNewSale({ amount: '', date: new Date().toISOString().split('T')[0], product: '' });
      addToast('🛒 Sale logged — signals updated');
      onSaved();
    } catch (err: any) {
      console.error('Failed to log sale:', err);
      setSaleError('Could not save: ' + (err.message || 'Unknown error'));
    } finally {
      setSaleSaving(false);
    }
  };

  const [newContact, setNewContact] = useState<ContactFieldValues>(EMPTY_CONTACT_FIELDS);
  const [addTried, setAddTried] = useState(false);
  const formFrom = (c: Company) => ({
    name: c.name,
    status: c.status,
    acquisition_source: c.acquisition_source ?? '',
    acquisition_campaign: c.acquisition_campaign ?? '',
    account_owner: c.account_owner || '',
    industry: c.industry || '',
    tags: (c.tags || []).join(', '),
    address: c.address || '',
    website: c.website || '',
    what_they_make: c.what_they_make || '',
    notes: c.notes || '',
    blocker_label: c.blocker_label || '',
  });
  const [editData, setEditData] = useState(() => formFrom(company));
  // The form is copied from the account as it is NOW when editing starts. Copying it once at
  // open meant a value saved meanwhile (a proposal's Save, Fill from website) was written back
  // as the old empty value on the next edit.
  const startEditing = () => {
    setEditData(formFrom(company));
    setConfirmArchive(false);
    setEditing(true);
  };
  const cancelEditing = () => {
    setEditData(formFrom(company));
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...editData,
        tags: editData.tags ? editData.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        ...normalizeAcquisition(editData),
        blocker_label: editData.blocker_label.trim() || null,
      };
      Object.assign(payload, { map_status: deriveMapStatus({ ...company, ...payload }) });
      const updated = await crm.updateCompany(company.id, payload);
      setEditData(formFrom(updated));
      setEditing(false);
      setSaved(true);
      onSaved();
      addToast('Company saved!');
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      console.error('Failed to update company:', err);
      setError('Could not save: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 flex items-end md:items-stretch justify-center md:justify-end z-50 p-0">
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
          // Bottom sheet on a phone; a full-height side panel on desktop, so a long record needs less scrolling.
          'relative bg-white dark:bg-clay-card w-full md:max-w-lg rounded-t-2xl md:rounded-none md:rounded-l-2xl p-6 max-h-[85vh] md:max-h-none md:h-full overflow-y-auto',
          saving ? 'opacity-80' : saved ? 'ring-2 ring-clay-success/40' : ''
        )}
        variants={panelVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={tweenSlow}
        onClick={e => e.stopPropagation()}
        {...dragHandlers}
      >
        <div className="mb-4 flex items-start gap-3.5">
          <label
            htmlFor={`logo-upload-${company.id}`}
            title="Drop or paste a logo, or tap to choose one"
            className={clsx('relative shrink-0 cursor-pointer rounded-[22%]', draggingImage && 'outline-2 outline-offset-[3px] outline-dashed outline-clay-lavender')}
          >
            <CompanyLogo src={company.logo_url} name={company.name} id={company.id} size={64} />
            {(draggingImage || logoSaving) && (
              <span className="absolute inset-0 flex items-center justify-center rounded-[22%] bg-white/75 text-center text-[10.5px] font-semibold leading-tight text-clay-ink dark:bg-white/80 dark:text-[#2b211a]">
                {logoSaving ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Saving logo" /> : <>Drop<br />logo</>}
              </span>
            )}
          </label>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              {editing ? (
                <input
                  type="text"
                  value={editData.name}
                  onChange={e => setEditData(prev => ({ ...prev, name: e.target.value }))}
                  aria-label="Account name"
                  className="min-w-0 flex-1 text-lg font-semibold text-clay-ink bg-transparent border-b border-clay-ink outline-none"
                />
              ) : (
                <h2 className="text-lg font-semibold leading-tight text-clay-ink">{company.name}</h2>
              )}
              <div className="relative flex shrink-0 items-center gap-0.5">
                {editing && (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="p-2 text-clay-success active:opacity-70 transition-all disabled:opacity-50"
                    aria-label="Save company"
                  >
                    {saving ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <span className={clsx('inline-flex transition-transform', saved && 'scale-110')}>
                        <Check className="w-5 h-5" />
                      </span>
                    )}
                  </button>
                )}
                {editing ? (
                  <button onClick={cancelEditing} className="px-2 py-1.5 text-xs font-medium text-clay-muted active:opacity-70">
                    Cancel
                  </button>
                ) : (
                  <button onClick={startEditing} className="p-2 text-clay-muted active:opacity-70" aria-label="Edit company">
                    <Edit2 className="w-5 h-5" />
                  </button>
                )}
                {!editing && (
                  <button onClick={() => setMenuOpen((v) => !v)} className="p-2 text-clay-muted active:opacity-70" aria-label="More actions" aria-expanded={menuOpen}>
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                )}
                <button onClick={onClose} className="p-2 text-clay-muted active:opacity-70" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
                {menuOpen && !editing && (
                  <div className="absolute right-0 top-10 z-10 w-52 overflow-hidden rounded-xl border border-clay-hairline bg-white py-1 text-sm shadow-lg dark:bg-clay-card" role="menu">
                    <label htmlFor={`logo-upload-${company.id}`} onClick={() => setMenuOpen(false)} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-clay-ink hover:bg-clay-surface" role="menuitem">
                      {logoSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
                      {company.logo_url ? 'Replace logo' : 'Upload logo'}
                    </label>
                    {!company.logo_url && !logoProposal && company.website?.trim() && (
                      <button onClick={() => { setMenuOpen(false); void handleFindLogo(); }} disabled={findingLogo} className="flex w-full items-center gap-2 px-3 py-2 text-left text-clay-ink hover:bg-clay-surface" role="menuitem">
                        {findingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Find logo on their site
                      </button>
                    )}
                    {company.logo_url && (
                      <button onClick={() => { setMenuOpen(false); void handleRemoveLogo(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-clay-ink hover:bg-clay-surface" role="menuitem">
                        <X className="w-4 h-4" /> Remove logo
                      </button>
                    )}
                    {isClosedDown(company) ? (
                      <button onClick={() => { setMenuOpen(false); void reopen(company).then(ok => { if (ok) onSaved(); }); }} disabled={closeBusy === company.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-clay-ink hover:bg-clay-surface" role="menuitem">
                        <DoorOpen className="w-4 h-4" /> Reopen
                      </button>
                    ) : (
                      <button onClick={() => { setMenuOpen(false); void closeDown(company).then(ok => { if (ok) onSaved(); }); }} disabled={closeBusy === company.id} className="flex w-full items-center gap-2 px-3 py-2 text-left text-clay-ink hover:bg-clay-surface" role="menuitem">
                        <DoorClosed className="w-4 h-4" /> Closed down
                      </button>
                    )}
                    <button onClick={() => { setMenuOpen(false); setConfirmArchive(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-clay-error hover:bg-clay-surface" role="menuitem" aria-label="Archive company">
                      <Trash2 className="w-4 h-4" /> Archive
                    </button>
                  </div>
                )}
              </div>
            </div>
            {!editing && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-clay-card px-1.5 py-0.5 text-[11px] text-clay-body">{COMPANY_STATUS_LABELS[company.status]}</span>
                {parentCompany && (
                  onOpenCompany ? (
                    <button type="button" onClick={() => onOpenCompany(parentCompany.id)} className={linkChip}>
                      <GitFork className="h-3 w-3" aria-hidden="true" />Branch of {parentCompany.name}
                    </button>
                  ) : (
                    <span className={linkChip}><GitFork className="h-3 w-3" aria-hidden="true" />Branch of {parentCompany.name}</span>
                  )
                )}
                {branches.length > 0 && (
                  <span className="inline-flex flex-wrap items-center gap-1 rounded bg-clay-card px-1.5 py-0.5 text-[11px] text-clay-body">
                    <GitFork className="h-3 w-3" aria-hidden="true" />
                    {branches.length === 1 ? '1 branch:' : `${branches.length} branches:`}
                    {branches.map((branch, i) => (
                      <span key={branch.id}>
                        {onOpenCompany ? (
                          <button type="button" onClick={() => onOpenCompany(branch.id)} className="font-medium text-clay-ink underline-offset-2 hover:underline">{branchLabel(company, branch)}</button>
                        ) : branchLabel(company, branch)}
                        {i < branches.length - 1 ? ',' : ''}
                      </span>
                    ))}
                  </span>
                )}
                {fit && (
                  <span className={clsx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', fit.fits ? 'bg-clay-lavender/20 text-clay-ink' : 'bg-clay-card text-clay-muted-soft')}>
                    <Sparkles className="h-3 w-3" aria-hidden="true" />{fitChipLabel(fit)}
                  </span>
                )}
                <LayaLeadTierBadge signal={leadSignal} />
              </div>
            )}
          </div>
          <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" id={`logo-upload-${company.id}`} />
        </div>
        {logoError && <div className="mb-4 text-xs text-clay-error">{logoError}</div>}
          {confirmArchive && (
            <div className="mb-4 rounded-xl border border-clay-hairline bg-clay-surface p-4">
              <div className="flex gap-3"><span className="text-2xl">🗑️</span><div><p className="font-semibold text-clay-ink">Archive this company?</p><p className="text-xs text-clay-muted mt-1">{company.name} and its linked contacts will be hidden from lists. You can undo this under Recent changes on This week.</p></div></div>
              <div className="grid grid-cols-2 gap-2 mt-3"><button onClick={() => { setConfirmArchive(false); setSaving(true); deleteEntity('company', company.id, company.name).then(() => { setSaving(false); addToast('Company archived'); onClose(); }).catch(err => { setSaving(false); setError('Could not archive: ' + (err.message || 'Unknown error')); }); }} className="px-3 py-2.5 bg-clay-error text-white text-sm font-medium rounded-lg">Archive</button><button onClick={() => setConfirmArchive(false)} className="px-3 py-2.5 bg-clay-card text-clay-ink text-sm font-medium rounded-lg">Cancel</button></div>
            </div>
          )}
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

        {editing ? (
          <div className="space-y-3 text-sm">
          <div className="text-clay-body">
            <span className="text-clay-muted">Status: </span>
            {editing ? (
              <select
                value={editData.status}
                onChange={e => setEditData(prev => ({ ...prev, status: e.target.value as CompanyStatus }))}
                className="inline-block px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
              >
                {(isClosedDown(company) ? [...statusOptions, 'closed' as CompanyStatus] : statusOptions).map(s => <option key={s} value={s}>{COMPANY_STATUS_LABELS[s]}</option>)}
              </select>
            ) : (
              <span className="px-2 py-0.5 bg-clay-card rounded text-xs">{COMPANY_STATUS_LABELS[company.status]}</span>
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">Owner: </span>
            {editing ? (
              <input
                type="text"
                value={editData.account_owner}
                onChange={e => setEditData(prev => ({ ...prev, account_owner: e.target.value }))}
                className="inline-block w-1/2 px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
              />
            ) : (
              company.account_owner || '—'
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">Source: </span>
            {editing ? (
              <span className="inline-flex w-full flex-wrap gap-2 align-middle sm:w-auto">
                <select
                  aria-label="Source"
                  value={editData.acquisition_source}
                  onChange={e => setEditData(prev => ({ ...prev, acquisition_source: e.target.value }))}
                  className="px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
                >
                  <option value="">— Not set —</option>
                  {ACQUISITION_SOURCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {editData.acquisition_source && (
                  <input
                    type="text"
                    aria-label="Campaign or ad"
                    placeholder="Campaign or ad"
                    value={editData.acquisition_campaign}
                    onChange={e => setEditData(prev => ({ ...prev, acquisition_campaign: e.target.value }))}
                    className="min-w-0 flex-1 px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
                  />
                )}
              </span>
            ) : (
              acquisitionLabel(company) ?? (company.lead_source ? <span className="text-clay-muted">Not set · noted “{company.lead_source}”</span> : '—')
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">Industry: </span>
            {editing ? (
              <input
                type="text"
                value={editData.industry}
                onChange={e => setEditData(prev => ({ ...prev, industry: e.target.value }))}
                className="inline-block w-1/2 px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
              />
            ) : (
              company.industry || '—'
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">Tags: </span>
            {editing ? (
              <input
                type="text"
                value={editData.tags}
                onChange={e => setEditData(prev => ({ ...prev, tags: e.target.value }))}
                className="inline-block w-2/3 px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
                placeholder="tag1, tag2"
              />
            ) : (
              <span className="text-xs">{(company.tags || []).map(t => <span key={t} className="inline-block bg-clay-card px-1.5 py-0.5 rounded mr-1">{t}</span>) || '—'}</span>
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">Website: </span>
            {editing ? (
              <input
                type="url"
                value={editData.website}
                onChange={e => setEditData(prev => ({ ...prev, website: e.target.value }))}
                className="inline-block w-2/3 px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
              />
            ) : company.website ? (
              <span className="inline-flex flex-wrap items-center">
                <span className="break-all">{company.website}</span>
                {(() => { const source = sourceOf('company', company.id, 'website', company.website); return source && <SourceChip source={source} />; })()}
              </span>
            ) : (
              '—'
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">What they make: </span>
            {editing ? (
              <input
                type="text"
                aria-label="What they make"
                placeholder="e.g. croissants, mille-feuille"
                value={editData.what_they_make}
                onChange={e => setEditData(prev => ({ ...prev, what_they_make: e.target.value }))}
                className="inline-block w-2/3 px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
              />
            ) : company.what_they_make ? (
              <span className="inline-flex flex-wrap items-center">
                <span>{company.what_they_make}</span>
                {(() => { const source = sourceOf('company', company.id, 'what_they_make', company.what_they_make); return source && <SourceChip source={source} />; })()}
              </span>
            ) : (
              '—'
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">Address:</span>
            {editing ? (
              <textarea
                value={editData.address}
                onChange={e => setEditData(prev => ({ ...prev, address: e.target.value }))}
                rows={2}
                className="w-full mt-1 px-2 py-2 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card resize-none"
              />
            ) : (
              <div className="bg-clay-surface rounded-lg p-3 text-clay-body text-xs leading-relaxed mt-1">
                {company.address ? (
                  <span className="flex flex-wrap items-center">
                    <span>{company.address}</span>
                    {(() => { const source = sourceOf('company', company.id, 'address', company.address); return source && <SourceChip source={source} />; })()}
                  </span>
                ) : waiting.some((p) => p.field === 'address') ? 'Waiting for you above' : 'No address yet'}
              </div>
            )}
          </div>

          <div className="text-clay-body">
            <span className="text-clay-muted">Blocker note: </span>
            <input
              type="text"
              aria-label="Blocker note"
              placeholder="Head office approves new suppliers"
              value={editData.blocker_label}
              onChange={e => setEditData(prev => ({ ...prev, blocker_label: e.target.value }))}
              className="inline-block w-2/3 px-2 py-1 border border-clay-hairline rounded text-base bg-white dark:bg-clay-card"
            />
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
                {company.notes || 'No notes yet'}
              </div>
            )}
          </div>
          </div>
        ) : (
        <>
        {!editing && step && (
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-clay-surface p-3">
            <CalendarClock className="h-5 w-5 shrink-0 text-clay-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <p className={clsx('font-medium', step.overdueDays > 0 ? 'text-clay-error' : 'text-clay-ink')}>
                {step.overdueDays > 0
                  ? `Follow-up ${step.overdueDays} day${step.overdueDays === 1 ? '' : 's'} overdue`
                  : step.date === today ? 'Follow up today' : `Follow up ${formatScheduleDate(step.date)}`}
              </p>
              <p className="truncate text-xs text-clay-muted">{[dealLabel(step.deal.title, company.name), step.deal.next_action].filter(Boolean).join(' · ')}</p>
            </div>
            <button type="button" onClick={() => setLogOpen(true)} className="shrink-0 rounded-lg border border-clay-hairline bg-white px-3 py-1.5 text-xs font-medium text-clay-ink active:bg-clay-surface dark:bg-clay-card">
              Log
            </button>
          </div>
        )}
        {!editing && (
          <WaitingForYou
            proposals={waiting}
            logo={logoProposal && !company.logo_url ? { url: logoProposal, site: siteHost(company.website), decide: decideLogoProposal } : null}
            onDecided={() => { setProfileVersion((v) => v + 1); onSaved(); refresh(); }}
          />
        )}

        <div className="space-y-3 text-sm">
          {companyDeals.length > 0 && (
            <div className="pt-1">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-clay-ink">Deals</h3>
                <span className="text-xs text-clay-muted">
                  {liveDeals.length} open{companyDeals.length > liveDeals.length ? ` · ${companyDeals.length - liveDeals.length} closed or parked` : ''}
                </span>
              </div>
              {liveDeals.map((deal) => (
                <Link
                  key={deal.id}
                  href={`/deals?deal=${encodeURIComponent(deal.id)}`}
                  className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-clay-body hover:bg-clay-surface"
                >
                  <Briefcase className="h-4 w-4 shrink-0 text-clay-muted" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-clay-ink">{dealLabel(deal.title, company.name)}</span>
                  <span className="shrink-0 rounded bg-clay-card px-1.5 py-0.5 text-[11px]">{STAGE_LABELS[deal.stage]}</span>
                  {deal.followup_date && <span className="shrink-0 text-xs text-clay-muted">next {formatScheduleDate(deal.followup_date.slice(0, 10))}</span>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-clay-muted-soft" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}

          {/* Buyer replies: Laya's reading of each latest reply, one line until opened */}
          {buyerReplyDeals > 0 && (
            <div>
              <button type="button" onClick={() => setRepliesOpen((v) => !v)} aria-expanded={repliesOpen} className="flex w-full items-center justify-between rounded-lg border border-clay-hairline px-3 py-2 text-left text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-clay-ink">Buyer replies</span>
                  <span className="text-clay-muted"> · {buyerReplyDeals === 1 ? '1 deal' : `${buyerReplyDeals} deals`} with a reply to read</span>
                </span>
                <ChevronDown className={clsx('h-4 w-4 shrink-0 text-clay-muted transition-transform', repliesOpen && 'rotate-180')} aria-hidden="true" />
              </button>
              {repliesOpen && (
                <LayaBuyerSignalsSection
                  deals={companyDeals}
                  companyFor={() => company}
                />
              )}
            </div>
          )}
          {isCustomer && (
            <>
          {health && (
            <div className="mt-4 pt-4 border-t border-clay-hairline">
              <h3 className="text-sm font-semibold text-clay-ink">Customer health</h3>
              <p className="mt-1 text-sm text-clay-body">
                {AHS_TIERS.find((t) => t.tier === health.tier)?.label ?? health.tier}
                {' · next check-in '}
                {(() => {
                  if (!isCalendarDateKey(health.dueDate)) return 'date needs review';
                  const days = businessDaysBetween(today, health.dueDate);
                  if (days < 0) return <span className="font-semibold text-clay-error">{-days} day{days === -1 ? '' : 's'} overdue</span>;
                  if (days === 0) return 'today';
                  return formatScheduleDate(health.dueDate);
                })()}
              </p>
              {accountEventsUnavailable && (
                <p className="mt-1 text-xs text-clay-muted">Sales history didn’t load, so health may be understated.</p>
              )}
            </div>
          )}
            {/* Rewards history (retention, read-only): only once a reward was given */}
            {meetings.some((m) => m.company_id === company.id && m.type === 'reward') && (
          <div className="mt-4 pt-4 border-t border-clay-hairline">
            <h3 className="text-sm font-semibold text-clay-ink flex items-center gap-1.5">
              <Gift className="w-4 h-4 text-clay-ochre" /> Rewards given
            </h3>
            {(() => {
              const rewards = meetings.filter((m) => m.company_id === company.id && m.type === 'reward');
              if (rewards.length === 0) {
                return <p className="text-xs text-clay-muted-soft mt-1.5">No surprise rewards logged yet.</p>;
              }
              return (
                <div className="mt-2 space-y-1.5">
                  {rewards.map((m) => (
                    <div key={m.id} className="bg-clay-surface rounded-lg p-2.5 text-xs text-clay-body">
                      <span className="font-medium text-clay-ink">{m.date}</span>
                      <span className="text-clay-muted"> · {m.description}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
            )}
          {/* Sales Section — log repeat orders without touching the deal board */}
          <div className="mt-4 pt-4 border-t border-clay-hairline">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-clay-ink">Sales</h3>
              <button
                onClick={() => setShowLogSale(!showLogSale)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-clay-hairline bg-clay-surface text-xs font-medium text-clay-ink active:bg-clay-card transition-colors"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                {showLogSale ? 'Cancel' : 'Log sale'}
              </button>
            </div>
            <p className="text-[11px] text-clay-muted mb-1">
              Log a repeat order; buying signals update right away.
            </p>

            {showLogSale && (
              <div className="bg-clay-surface rounded-xl p-3 mb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={newSale.amount}
                    onChange={e => setNewSale(prev => ({ ...prev, amount: e.target.value }))}
                    placeholder="Amount ฿ *"
                    className="px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card"
                  />
                  <input
                    type="date"
                    value={newSale.date}
                    onChange={e => setNewSale(prev => ({ ...prev, date: e.target.value }))}
                    className="px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card"
                  />
                </div>
                <input
                  type="text"
                  value={newSale.product}
                  onChange={e => setNewSale(prev => ({ ...prev, product: e.target.value }))}
                  placeholder="Product (optional)"
                  className="w-full px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card"
                />
                {saleError && <p className="text-xs text-clay-error">{saleError}</p>}
                <button
                  onClick={handleLogSale}
                  disabled={saleSaving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-clay-ink text-clay-canvas text-sm font-medium rounded-lg active:opacity-85 min-h-[48px] disabled:opacity-60"
                >
                  {saleSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                  {saleSaving ? 'Logging…' : 'Log sale'}
                </button>
              </div>
            )}
          </div>
            </>
          )}
          {/* Contacts Section */}
          <div className="mt-4 pt-4 border-t border-clay-hairline">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-clay-ink">People ({people.length})</h3>
              <button
                onClick={() => setShowAddContact(!showAddContact)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-clay-hairline bg-clay-surface text-xs font-medium text-clay-ink active:bg-clay-card transition-colors"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {showAddContact ? 'Cancel' : 'Add'}
              </button>
            </div>

            {/* Add contact form */}
            {showAddContact && (
              <div className="bg-clay-surface rounded-xl p-3 mb-3 space-y-3">
                <ContactFields
                  values={newContact}
                  onChange={patch => setNewContact(prev => ({ ...prev, ...patch }))}
                  showProblems={addTried}
                />
                <button
                  onClick={async () => {
                    const problem = contactFieldsProblem(newContact);
                    if (problem) {
                      setAddTried(true);
                      addToast(problem, 'error');
                      return;
                    }
                    setSaving(true);
                    setError(null);
                    try {
                      await createContact({
                        ...contactFieldsForSave(newContact),
                        company_id: company.id,
                        status: 'uncontacted',
                        notes: '',
                        last_contacted_date: null,
                      });
                      setNewContact(EMPTY_CONTACT_FIELDS);
                      setAddTried(false);
                      setShowAddContact(false);
                      onSaved();
                      refresh();
                      addToast('Contact added!');
                    } catch (err: any) {
                      console.error('Failed to create contact:', err);
                      setError('Could not save: ' + (err.message || 'Unknown error'));
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-clay-ink text-clay-canvas text-sm font-medium rounded-lg active:opacity-85 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Save contact
                </button>
              </div>
            )}

            {suggestion && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-clay-hairline px-3 py-2 text-sm">
                <Lightbulb className="h-4 w-4 shrink-0 text-clay-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-clay-body">{suggestion.name} is the {suggestion.job_title}. Set as the one who decides?</span>
                <button type="button" onClick={() => void setRole(suggestion.id, 'decides')} disabled={roleSaving} className="shrink-0 rounded-lg border border-clay-hairline bg-white px-2.5 py-1 text-xs font-medium text-clay-ink disabled:opacity-60 dark:bg-clay-card">Set</button>
              </div>
            )}
            {company.blocker_label?.trim() && !company.blocker_contact_id && (
              <p className="mb-2 text-xs text-clay-muted"><span className={clsx('mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium', ROLE_STYLE.blocker)}>Blocker</span>{company.blocker_label}</p>
            )}
            {people.length > 0 ? (
              <div className="space-y-2">
                {people.map((contact: Contact) => {
                  const source = contactSource(contact);
                  return (
                  <div key={contact.id} className="bg-clay-surface rounded-lg">
                  <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setOpenContactId(contact.id)}
                    aria-label={`Open contact: ${contact.name}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-3 text-left text-sm text-clay-body hover:bg-clay-card transition-colors"
                  >
                    <EntityAvatar kind="person" name={contact.name} id={contact.id} size={32} className="flex-shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 font-medium text-clay-ink">
                        {contact.name}
                        {(() => { const role = roleOf(company, contact.id); return role && <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-medium', ROLE_STYLE[role])}>{ROLE_LABELS[role]}</span>; })()}
                      </span>
                      <span className="block text-xs text-clay-muted">{[contact.job_title || contact.email, !contact.email && !contact.phone && !contact.line ? 'no channel yet' : null].filter(Boolean).join(' · ')}</span>
                      {contact.phone && (
                        <span className="block text-xs text-clay-muted-soft">📱 {contact.phone}</span>
                      )}
                      {contact.phone_second && (
                        <span className="block text-xs text-clay-ochre">📱 {contact.phone_second}</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoleFor((id) => (id === contact.id ? null : contact.id))}
                    aria-label={`Set role for ${contact.name}`}
                    aria-expanded={roleFor === contact.id}
                    className="mr-1 shrink-0 rounded-lg p-2 text-clay-muted-soft hover:bg-clay-card"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  </div>
                  {roleFor === contact.id && (
                    <div className="flex flex-wrap gap-1.5 px-3 pb-2.5" role="group" aria-label={`Role for ${contact.name}`}>
                      {(['decides', 'champion', 'blocker'] as const).map((role) => (
                        <button key={role} type="button" onClick={() => void setRole(contact.id, role)} disabled={roleSaving}
                          aria-pressed={roleOf(company, contact.id) === role}
                          className={clsx('rounded-md px-2 py-1 text-xs font-medium disabled:opacity-60', roleOf(company, contact.id) === role ? ROLE_STYLE[role] : 'border border-clay-hairline bg-white text-clay-ink dark:bg-clay-card')}>
                          {ROLE_LABELS[role]}
                        </button>
                      ))}
                      {roleOf(company, contact.id) && (
                        <button type="button" onClick={() => void setRole(contact.id, null)} disabled={roleSaving} className="rounded-md px-2 py-1 text-xs text-clay-muted disabled:opacity-60">No role</button>
                      )}
                    </div>
                  )}
                  {source && <div className="flex flex-wrap items-center px-3 pb-2 -mt-1.5"><SourceChip source={source} /></div>}
                  </div>
                  );
                })}
              </div>
            ) : null}

            {routes.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-clay-muted">Contact channels</p>
                <ul className="divide-y divide-clay-hairline rounded-lg border border-clay-hairline">
                  {routes.map((route) => {
                    const source = contactSource(route);
                    return (
                    <li key={route.id}>
                      <button
                        type="button"
                        onClick={() => setOpenContactId(route.id)}
                        aria-label={`Open contact channel: ${route.name}`}
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-xs text-clay-body hover:bg-clay-surface"
                      >
                        {(() => {
                          // Every app in its own words; an old LINE box holding Instagram or WhatsApp is read right.
                          const ways = channelsOf(route);
                          const shown = CHANNEL_ORDER.filter(k => ways[k]);
                          return shown.length === 0
                            ? <span className="text-clay-muted">{route.name}</span>
                            : shown.map(k => <span key={k} className={k === 'email' ? 'break-all' : undefined}>{ROUTE_WORD[k]} {k === 'instagram' ? `@${ways[k]}` : ways[k]}</span>);
                        })()}
                      </button>
                      {source && <div className="flex flex-wrap items-center px-3 pb-2 -mt-1"><SourceChip source={source} /></div>}
                    </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          {/* Activity — every interaction with this account or its people */}
          <div className="mt-4 pt-4 border-t border-clay-hairline">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-clay-ink">Activity ({accountInteractions.length})</h3>
              <button
                type="button"
                onClick={() => setLogOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-clay-ink text-clay-canvas text-xs font-medium active:opacity-85 transition-opacity min-h-[36px]"
              >
                <Plus className="w-3.5 h-3.5" /> Log interaction
              </button>
            </div>
            <InteractionThread meetings={showAllActivity ? accountInteractions : accountInteractions.slice(0, 2)} allContacts={contacts} deals={deals} companies={companies} />
            {accountInteractions.length > 2 && (
              <button type="button" onClick={() => setShowAllActivity((v) => !v)} className="mt-2 text-xs font-medium text-clay-muted">
                {showAllActivity ? 'Show less' : `Show all ${accountInteractions.length}`}
              </button>
            )}
          </div>
          {/* Details: folded; empty fields are left out rather than shown as "—" */}
          <div className="mt-4 pt-4 border-t border-clay-hairline">
            <button type="button" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen} className="flex w-full items-center justify-between text-sm font-semibold text-clay-ink">
              Details
              <ChevronDown className={clsx('h-4 w-4 text-clay-muted transition-transform', detailsOpen && 'rotate-180')} aria-hidden="true" />
            </button>
            {detailsOpen && (
              <div className="mt-2 space-y-2 text-sm">
                {company.website && (
                  <DetailRow label="Website">
                    <span className="break-all">{company.website}</span>
                    {(() => { const source = sourceOf('company', company.id, 'website', company.website); return source && <SourceChip source={source} />; })()}
                  </DetailRow>
                )}
                {company.what_they_make && (
                  <DetailRow label="What they make">
                    <span>{company.what_they_make}</span>
                    {(() => { const source = sourceOf('company', company.id, 'what_they_make', company.what_they_make); return source && <SourceChip source={source} />; })()}
                  </DetailRow>
                )}
                {company.address ? (
                  <DetailRow label="Address">
                    <span>{company.address}</span>
                    {(() => { const source = sourceOf('company', company.id, 'address', company.address); return source && <SourceChip source={source} />; })()}
                  </DetailRow>
                ) : waiting.some((p) => p.field === 'address') ? (
                  <DetailRow label="Address"><span className="text-clay-muted">Waiting for you above</span></DetailRow>
                ) : null}
                {company.industry && <DetailRow label="Industry"><span>{company.industry}</span></DetailRow>}
                {company.tags.length > 0 && (
                  <DetailRow label="Tags">
                    {company.tags.map((t) => <span key={t} className="mb-1 mr-1 inline-block rounded bg-clay-card px-1.5 py-0.5 text-xs dark:bg-white/[0.06]">{t}</span>)}
                  </DetailRow>
                )}
                {(acquisitionLabel(company) || company.lead_source) && (
                  <DetailRow label="Source"><span>{acquisitionLabel(company) ?? company.lead_source}</span></DetailRow>
                )}
                {notes && (
                  <DetailRow label="Notes">
                    <span className="whitespace-pre-line text-xs leading-relaxed">
                      {notesOpen || notes.length <= 180 ? notes : `${notes.slice(0, 180).trimEnd()}…`}
                    </span>
                    {notes.length > 180 && (
                      <button type="button" onClick={() => setNotesOpen((v) => !v)} className="ml-1 text-xs font-medium text-clay-muted">
                        {notesOpen ? 'less' : 'more'}
                      </button>
                    )}
                  </DetailRow>
                )}
                {fit && <FitCard fit={fit} />}
                <WebsiteFill company={company} companyContacts={companyContacts} onSaved={onSaved} />
              </div>
            )}
          </div>

        </div>
        </>
        )}
      </motion.div>
    </div>

    {openContact && (
      <ContactDetail
        contact={openContact}
        onClose={() => setOpenContactId(null)}
        onSaved={onSaved}
        companies={companies}
      />
    )}
    <LogInteractionModal
      isOpen={logOpen}
      onClose={() => setLogOpen(false)}
      onSave={async (meeting) => { await addMeeting(meeting); }}
      deals={deals}
      contacts={contacts}
      companies={companies}
      initialCompanyId={company.id}
    />
    </>
  );
}
