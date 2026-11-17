'use client';

import { useEffect, useState } from 'react';
import { Company, Contact, Deal, DealWorkflowAction, PRODUCT_OPTIONS, COMPANY_STATUS_LABELS, CONTACT_STATUS_LABELS, MEETING_TYPE_LABELS } from '@/types/crm';
import { X, Save, Building2, Users, Kanban, Calendar, Mail, MessageCircle, Phone } from 'lucide-react';
import LinkFill from '@/components/LinkFill';
import { existingAccount, leadNotes, leadRoute, type LeadRoute } from '@/utils/lead-apply';
import type { PageLead } from '@/utils/page-extract';
import ContactPicker from '@/components/ContactPicker';
import { NUDGE_OPTIONS, SAMPLE_STATUS_OPTIONS, WORKFLOW_BY_ID, WORKFLOW_LANES } from '@/utils/deal-workflow';
import { deriveDealIdentity } from '@/utils/dealLabel';
import ContactFields, { EMPTY_CONTACT_FIELDS, contactFieldsForSave, contactFieldsProblem, type ContactFieldValues } from '@/components/ContactFields';
import ModalShell from '@/components/motion/ModalShell';
import { ACQUISITION_SOURCE_OPTIONS, DEAL_FORM_SOURCE_KEY, normalizeAcquisition } from '@/utils/acquisition-source';

type ModalType = 'company' | 'contact' | 'deal' | 'meeting';
const DRAFTING_WORKFLOWS = new Set<DealWorkflowAction>(['outreach', 'reply', 'reschedule']);

interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void | Promise<void>;
  type: ModalType;
  companies?: Company[];
  contacts?: Contact[];
  deals?: Deal[];
  /** Pre-filled fields merged over the blank form each time it opens, e.g. { company_id }. */
  initialValues?: Record<string, unknown>;
  /** New account only: a link to read the details from as the form opens. */
  initialLink?: string | null;
}

export default function CreateModal({ isOpen, onClose, onSave, type, companies = [], contacts = [], deals = [], initialValues, initialLink }: CreateModalProps) {
  const [form, setForm] = useState<Record<string, any>>(() => ({ ...getInitialState(type), ...initialValues }));
  const [error, setError] = useState<string | null>(null);
  // After a save was tried, the contact fields say what is missing.
  const [triedSave, setTriedSave] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm({ ...getInitialState(type), ...initialValues });
      setError(null);
    }
  }, [isOpen, type, initialValues]);

  function getInitialState(t: ModalType) {
    switch (t) {
      case 'company': return { name: '', status: 'prospect', lead_source: '', acquisition_source: '', acquisition_campaign: '', account_owner: 'Pat', tags: '', industry: '', size: 'B', address: '', website: '', notes: '' };
      case 'contact': return { name: '', identity_quality: 'unknown', outreach_language: 'autodetect', email: '', phone: '', phone_second: '', line: '', instagram: '', whatsapp: '', job_title: '', company_id: '', status: 'uncontacted', notes: '' };
      // title + client are auto-derived from Product + Company on submit (no manual entry)
      case 'deal': return { stage: 'research', product: 'Butter', company_id: '', contact_ids: [] as string[], value: '', priority: 'medium', next_action: '', draft_primary_ask: '', followup_date: '', workflow_action: 'outreach', nudge_stage: '', sample_status: '', notes: '' };
      case 'meeting': return { description: '', type: 'call', date: new Date().toISOString().split('T')[0], company_id: '', contact_ids: [] as string[], deal_id: '', product: 'Butter', summary: '', outcome: '', followup_date: '' };
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev: Record<string, any>) => ({ ...prev, [name]: value }));
  };

  // Details read from a link fill only the fields still blank; anything typed stays.
  const applyLead = (lead: PageLead) => {
    setForm(prev => ({
      ...prev,
      name: prev.name?.trim() ? prev.name : lead.name ?? '',
      website: prev.website?.trim() ? prev.website : lead.website ?? '',
      address: prev.address?.trim() ? prev.address : lead.address ?? '',
      notes: prev.notes?.trim() ? prev.notes : leadNotes(lead),
      logo_url: lead.logoUrl,
      contact_route: leadRoute(lead),
    }));
  };
  const route: LeadRoute | null = type === 'company' ? form.contact_route ?? null : null;
  // New deal: the selected company's source, unless Pat changed it in this form.
  const dealCompany = type === 'deal' ? companies.find(c => c.id === form.company_id) : undefined;
  const dealSourceValue: string = form.deal_source ?? dealCompany?.acquisition_source ?? '';
  const dealCampaignValue: string = form.deal_campaign ?? dealCompany?.acquisition_campaign ?? '';
  const handleDealCompanyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { value } = e.target;
    setForm(prev => ({ ...prev, company_id: value, deal_source: undefined, deal_campaign: undefined }));
  };
  const duplicate = type === 'company' ? existingAccount(companies, form.name ?? '', form.website ?? '') : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (type === 'deal') {
      const laneError = validateDealWorkflow(form);
      if (laneError) {
        setError(laneError);
        return;
      }
    }
    if (type === 'contact') {
      const problem = contactFieldsProblem({ identity_quality: form.identity_quality, name: form.name ?? '' });
      if (problem) {
        setTriedSave(true);
        setError(problem);
        return;
      }
    }
    setError(null);
    setTriedSave(false);
    const cleaned: Record<string, any> = type === 'contact' ? contactFieldsForSave({ ...form }) : { ...form };
    if (cleaned.tags) cleaned.tags = cleaned.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    if (type === 'company') Object.assign(cleaned, normalizeAcquisition(cleaned));
    if (type === 'deal') {
      cleaned.value = cleaned.value === '' || cleaned.value == null ? null : parseFloat(cleaned.value) || null;
      delete cleaned.notes;
      // Auto-derive title + client from Product + Company (or Contact) — no manual text entry.
      const co = companies.find((c) => c.id === cleaned.company_id);
      const ct = contacts.find((c) => (cleaned.contact_ids || [])[0] === c.id);
      const derived = deriveDealIdentity(cleaned.product, co?.name || '', ct?.name || '');
      cleaned.title = derived.title;
      cleaned.client = derived.client;
      // The source belongs to the company: send it as a company change, only when Pat changed it.
      delete cleaned.deal_source;
      delete cleaned.deal_campaign;
      if (co) {
        const next = normalizeAcquisition({ acquisition_source: dealSourceValue, acquisition_campaign: dealCampaignValue });
        if (next.acquisition_source !== (co.acquisition_source ?? null) || next.acquisition_campaign !== (co.acquisition_campaign ?? null)) {
          cleaned[DEAL_FORM_SOURCE_KEY] = next;
        }
      }
    }
    try {
      await onSave(cleaned);
      setForm(getInitialState(type));
      onClose();
    } catch (err: any) {
      setError('Could not save: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleWorkflowChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lane = e.target.value;
    setForm((prev: Record<string, any>) => {
      const next: Record<string, any> = { ...prev, workflow_action: lane };
      if (lane !== 'reschedule') next.nudge_stage = '';
      if (lane !== 'sample') next.sample_status = '';
      // "Successful" is a real outcome — it closes the deal, like the detail drawer does.
      if (lane === 'success') {
        next.stage = 'closed_won';
        next.followup_date = '';
      }
      return next;
    });
  };

  const titles: Record<ModalType, string> = { company: 'New Company', contact: 'New Contact', deal: 'New Deal', meeting: 'Log Interaction' };
  const icons: Record<ModalType, React.ReactNode> = { company: <Building2 className="w-5 h-5" />, contact: <Users className="w-5 h-5" />, deal: <Kanban className="w-5 h-5" />, meeting: <Calendar className="w-5 h-5" /> };
  const showDraftingBrief = type === 'deal' && (DRAFTING_WORKFLOWS.has(form.workflow_action) || Boolean(form.draft_primary_ask?.trim()));

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      panelClassName="bg-white dark:bg-clay-card md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
    >
      <>
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-clay-card flex items-center justify-between p-4 border-b border-clay-hairline z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-clay-ink text-clay-canvas flex items-center justify-center">{icons[type]}</div>
            <h2 className="text-lg font-semibold text-clay-ink">{titles[type]}</h2>
          </div>
          <button onClick={onClose} className="text-clay-muted hover:text-clay-ink p-2 -mr-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {type === 'company' && (
            <>
              <LinkFill key={String(isOpen)} initialLink={initialLink} onLead={applyLead} />
              <Field label="Company Name *" name="name" value={form.name} onChange={handleChange} required placeholder="e.g., April's Bakery" />
              {duplicate && (
                <p role="status" className="-mt-2 rounded-lg bg-clay-ochre/10 px-3 py-2 text-xs text-clay-ink">
                  You already have an account called {duplicate.name}. Saving adds a second one.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Select label="Status" name="status" value={form.status} onChange={handleChange} options={Object.entries(COMPANY_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
                <Select label="Source" name="acquisition_source" value={form.acquisition_source} onChange={handleChange} options={[{ value: '', label: '— Not set —' }, ...ACQUISITION_SOURCE_OPTIONS]} />
              </div>
              {form.acquisition_source && (
                <Field label="Campaign or ad (optional)" name="acquisition_campaign" value={form.acquisition_campaign} onChange={handleChange} placeholder="e.g., Croissant butter · Oct" />
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Account Owner" name="account_owner" value={form.account_owner} onChange={handleChange} />
                <Select label="Size" name="size" value={form.size} onChange={handleChange} options={[{ value: 'A', label: 'A — Large' }, { value: 'B', label: 'B — Medium' }, { value: 'C', label: 'C — Small' }]} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Industry" name="industry" value={form.industry} onChange={handleChange} placeholder="e.g., Food & Beverage" />
                <Field label="Tags (comma-separated)" name="tags" value={form.tags} onChange={handleChange} placeholder="bakery, chain, export" />
              </div>
              <Field label="Address" name="address" value={form.address} onChange={handleChange} placeholder="Full address" />
              <Field label="Website" name="website" value={form.website} onChange={handleChange} placeholder="https://..." />
              <TextArea label="Notes" name="notes" value={form.notes} onChange={handleChange} rows={3} />
              {route && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-clay-body">Ways to reach them, saved with the account</p>
                  <div className="flex flex-wrap gap-1.5">
                    {route.email && <RouteChip icon={<Mail className="h-3.5 w-3.5" aria-hidden="true" />} text={route.email} />}
                    {route.phone && <RouteChip icon={<Phone className="h-3.5 w-3.5" aria-hidden="true" />} text={route.phone} />}
                    {route.line && <RouteChip icon={<MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />} text={`LINE ${route.line}`} />}
                  </div>
                </div>
              )}
            </>
          )}

          {type === 'contact' && (
            <>
              <ContactFields
                values={{ ...EMPTY_CONTACT_FIELDS, ...(form as Partial<ContactFieldValues>) }}
                onChange={patch => setForm((prev: Record<string, any>) => ({ ...prev, ...patch }))}
                showProblems={triedSave}
              />
              <Select label="Company" name="company_id" value={form.company_id} onChange={handleChange} options={[{ value: '', label: '— None —' }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
              <Select label="Status" name="status" value={form.status} onChange={handleChange} options={Object.entries(CONTACT_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
              <TextArea label="Notes" name="notes" value={form.notes} onChange={handleChange} rows={3} />
            </>
          )}

          {type === 'deal' && (
            <>
              <div className="rounded-lg bg-clay-surface px-3 py-2 text-xs text-clay-muted">
                Deal name &amp; client auto-fill from Product + Company below.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Product" name="product" value={form.product} onChange={handleChange} options={PRODUCT_OPTIONS.map(p => ({ value: p, label: p }))} />
                <Select label="Priority" name="priority" value={form.priority} onChange={handleChange} options={[{ value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />
              </div>
              <Select label="Company" name="company_id" value={form.company_id} onChange={handleDealCompanyChange} options={[{ value: '', label: '— None —' }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
              {dealCompany && (
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Source" name="deal_source" value={dealSourceValue} onChange={handleChange} options={[{ value: '', label: '— Not set —' }, ...ACQUISITION_SOURCE_OPTIONS]} />
                  {dealSourceValue ? (
                    <Field label="Campaign or ad" name="deal_campaign" value={dealCampaignValue} onChange={handleChange} placeholder="Optional" />
                  ) : <div />}
                  <p className="col-span-2 -mt-2 text-xs text-clay-muted">Saved on {dealCompany.name}; every deal with them shares it.</p>
                </div>
              )}
              <Field label="Value (THB)" name="value" value={form.value} onChange={handleChange} placeholder="e.g., 50000" />
              <div>
                <Select label="Action Lane" name="workflow_action" value={form.workflow_action} onChange={handleWorkflowChange} options={WORKFLOW_LANES.map(lane => ({ value: lane.id, label: lane.label }))} />
                <p className="text-xs text-clay-muted mt-1">{WORKFLOW_BY_ID[form.workflow_action as DealWorkflowAction]?.description}</p>
              </div>
              {form.workflow_action === 'sample' && (
                <Select label="Sample Status" name="sample_status" value={form.sample_status} onChange={handleChange} options={[{ value: '', label: '— Choose status —' }, ...SAMPLE_STATUS_OPTIONS.map(option => ({ value: option.value, label: option.label }))]} />
              )}
              <Field label="CRM next action" name="next_action" value={form.next_action} onChange={handleChange} placeholder="What needs to happen internally?" />
              {showDraftingBrief && (
                <section className="rounded-xl border border-clay-lavender/30 bg-clay-lavender/10 p-3">
                  <p className="text-[10px] font-semibold tracking-wider text-clay-muted">EBIMARU DRAFTING BRIEF</p>
                  <p className="mt-1 mb-3 text-xs text-clay-muted">One client question only. This is drafting guidance, not a send instruction.</p>
                  <Field label="Primary client ask" name="draft_primary_ask" value={form.draft_primary_ask} onChange={handleChange} placeholder="What one thing should the client answer?" />
                </section>
              )}
              <Field label="Follow-up Date" name="followup_date" type="date" value={form.followup_date} onChange={handleChange} />
              <ContactPicker contacts={contacts} companies={companies} selectedCompanyId={form.company_id} selectedIds={form.contact_ids || []} onChange={ids => setForm(prev => ({ ...prev, contact_ids: ids }))} />
            </>
          )}

          {type === 'meeting' && (
            <>
              <Field label="Description *" name="description" value={form.description} onChange={handleChange} required placeholder="e.g., Follow-up call with K. Oil" />
              <div className="grid grid-cols-2 gap-3">
                <Select label="Type" name="type" value={form.type} onChange={handleChange} options={Object.entries(MEETING_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
                <Field label="Date" name="date" type="date" value={form.date} onChange={handleChange} />
              </div>
              <Select label="Company" name="company_id" value={form.company_id} onChange={handleChange} options={[{ value: '', label: '— None —' }, ...companies.map(c => ({ value: c.id, label: c.name }))]} />
              <Select label="Linked Deal" name="deal_id" value={form.deal_id} onChange={handleChange} options={[{ value: '', label: '— None —' }, ...deals.map(d => ({ value: d.id, label: `${d.client} — ${d.title}` }))]} />
              <ContactPicker contacts={contacts} companies={companies} selectedCompanyId={form.company_id} selectedIds={form.contact_ids || []} onChange={ids => setForm(prev => ({ ...prev, contact_ids: ids }))} />
              <TextArea label="Summary / Notes" name="summary" value={form.summary} onChange={handleChange} rows={3} placeholder="What was discussed, decided, or needs follow-up..." />
              <div className="grid grid-cols-2 gap-3">
                <Select label="Outcome" name="outcome" value={form.outcome} onChange={handleChange} options={[{ value: '', label: '— None —' }, { value: 'positive', label: 'Positive' }, { value: 'neutral', label: 'Neutral' }, { value: 'negative', label: 'Negative' }, { value: 'no_response', label: 'No Response' }]} />
                <Field label="Follow-up Date" name="followup_date" type="date" value={form.followup_date} onChange={handleChange} />
              </div>
            </>
          )}

          {/* Actions */}
          {error && <div className="rounded-lg bg-clay-error/10 px-3 py-2 text-sm text-clay-error">{error}</div>}
          <div className="flex items-center gap-3 pt-2 pb-4">
            <button type="submit" className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-clay-ink text-clay-canvas text-sm font-medium rounded-lg motion-press min-h-[48px]">
              <Save className="w-4 h-4" /> Save
            </button>
            <button type="button" onClick={onClose} className="px-4 py-3 bg-clay-card text-clay-ink text-sm font-medium rounded-lg motion-press min-h-[48px]">Cancel</button>
          </div>
        </form>
      </>
    </ModalShell>
  );
}

// Same lane rules as the DealDetail drawer, applied at creation time.
function validateDealWorkflow(form: Record<string, any>): string | null {
  const lane = form.workflow_action;
  if (lane === 'sample' && !form.sample_status) return 'Choose whether the sample was sent or received.';
  if (lane === 'testing' && !form.followup_date) return 'Set the client testing date before saving.';
  if (lane === 'reschedule' && !form.followup_date) return 'Set the rescheduled follow-up date.';
  if (lane === 'parked' && !form.followup_date) return 'Parked deals need a revisit date.';
  return null;
}

function RouteChip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-clay-surface px-2 py-1 text-xs text-clay-body">
      <span className="shrink-0 text-clay-muted-soft">{icon}</span>
      <span className="truncate">{text}</span>
    </span>
  );
}

function Field({ label, name, value, onChange, type = 'text', required, placeholder }: { label: string; name: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-clay-body mb-1">{label}</label>
      <input type={type} name={name} value={value} onChange={onChange} required={required} placeholder={placeholder} className="w-full px-3 py-3 border border-clay-hairline rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-clay-ink bg-white dark:bg-clay-card text-clay-ink" />
    </div>
  );
}

function TextArea({ label, name, value, onChange, rows = 3, placeholder }: { label: string; name: string; value: string; onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; rows?: number; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-clay-body mb-1">{label}</label>
      <textarea name={name} value={value} onChange={onChange} rows={rows} placeholder={placeholder} className="w-full px-3 py-3 border border-clay-hairline rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-clay-ink resize-none bg-white dark:bg-clay-card text-clay-ink" />
    </div>
  );
}

function Select({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-sm font-medium text-clay-body mb-1">{label}</label>
      <select name={name} value={value} onChange={onChange} className="w-full px-3 py-3 border border-clay-hairline rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-clay-ink bg-white dark:bg-clay-card text-clay-ink">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
