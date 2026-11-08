'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Check, Edit2, Loader2, Undo2, X, MessageCircle, MoreHorizontal, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Deal, DealWorkflowAction, SampleStatus } from '@/types/crm';
import { useToast } from '@/components/ToastProvider';
import { useCrm } from '@/components/CrmProvider';
import { dealClientName } from '@/utils/dealLabel';
import * as crm from '@/lib/crm';
import {
  SAMPLE_STATUS_OPTIONS,
  WORKFLOW_BY_ID,
  WORKFLOW_LANES,
  getWorkflowAction,
  deriveNudge,
  formatDerivedNudgeBadge,
  outboundSendCountForDeal,
  nudgeColorClass,
} from '@/utils/deal-workflow';
import { localDateKey } from '@/utils/deal-board';
import {
  buildDealEditPayload,
  dealToEditDraft,
  dealEditFieldLabel,
  detectDraftConflicts,
  isEmptyPayload,
  mergeDraft,
  type DealEditDraft,
  type DealEditField,
} from '@/utils/deal-edit-draft';
import { buildCloseUpdate } from '@/utils/deal-close';
import { formatBaht } from '@/utils/format';
import { nudgeChipLabel } from '@/utils/deal-card';
import { formatScheduleDate } from '@/utils/deal-schedule';
import { lanePrefill } from '@/utils/lane-playbook';
import { outreachLanguageLabel, outreachLanguageBadgeColor, outreachLanguageBasisLabel } from '@/utils/contact-identity';
import LogInteractionModal from '@/components/LogInteractionModal';
import CompanyLogo from '@/components/CompanyLogo';
import ExitDealModal, { ExitDealPayload } from '@/components/ExitDealModal';
import AccountSourceField from '@/components/AccountSourceField';
import StakeholderMiniMap from '@/components/StakeholderMiniMap';
import LayaScoreCard from '@/components/LayaScoreCard';
import DealFactsPanel from '@/components/DealFactsPanel';
import QuickReplyBox from '@/components/QuickReplyBox';
import MessageDraft, { type DraftChannel } from '@/components/MessageDraft';
import DealTimeline from '@/components/DealTimeline';
import LayaGradePanel from '@/components/LayaGradePanel';
import type { OutreachLanguage } from '@/types/crm';
import { motion } from 'framer-motion';
import { overlayVariants, panelVariants, tweenBase, tweenSlow } from '@/lib/motion';

interface DealDetailProps {
  deal: Deal;
  onClose: () => void;
  onSaved: () => void;
}

function isPassiveNextAction(value?: string | null) {
  return /^(awaiting|waiting|pending)\b/i.test(value?.trim() || '');
}

export default function DealDetail({ deal, onClose, onSaved }: DealDetailProps) {
  const { addToast } = useToast();
  const { logActivity, deleteEntity, companies, contacts, meetings = [], addMeeting } = useCrm();
  const currentWorkflow = getWorkflowAction(deal);
  const today = localDateKey();
  const sendCount = useMemo(() => outboundSendCountForDeal(meetings, deal.id), [meetings, deal.id]);
  const derived = deriveNudge(deal, today, { sendCount });
  const dealCompany = useMemo(() => (deal.company_id ? companies.find(c => c.id === deal.company_id) : undefined), [deal.company_id, companies]);
  // Facts that used to hide behind "Commercial details": visible at a glance under the title.
  // Priority only earns a place in the header when it's high.
  const headerFacts = [
    deal.product,
    deal.value != null ? formatBaht(Number(deal.value)) : null,
    deal.priority === 'high' ? 'High' : null,
  ].filter(Boolean).join(' · ');

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<Partial<Deal> | null>(null);
  const [draftLanguage, setDraftLanguage] = useState<OutreachLanguage>('autodetect');
  const [inboundContextOpen, setInboundContextOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // Set when the log form is opened from a sent draft: the channel used and a title.
  const [logPrefill, setLogPrefill] = useState<{ channel: DraftChannel; notes: string } | null>(null);
  const [exitKind, setExitKind] = useState<'won' | 'lost' | 'park' | null>(null);

  // The form is derived from the LATEST record plus the user's own unsaved edits —
  // never a snapshot taken when the editor opened. A deal that moves in the
  // background is therefore reflected immediately (lane + history), while anything
  // the user typed is kept and written back.
  const baseDraft = useMemo(() => dealToEditDraft(deal), [deal]);
  // `values` are the user's unsaved edits; `baseline` records what a field looked like
  // when the user began editing it, which is how a conflict is detected without reading
  // a ref during render.
  const [editState, setEditState] = useState<{
    values: Partial<DealEditDraft>;
    baseline: Partial<DealEditDraft>;
  }>({ values: {}, baseline: {} });
  const editData = useMemo(() => mergeDraft(baseDraft, editState.values), [baseDraft, editState.values]);
  const conflicts = useMemo(
    () => detectDraftConflicts(editState.baseline, baseDraft, editState.values),
    [editState, baseDraft]
  );

  const setField = <K extends DealEditField>(field: K, value: DealEditDraft[K]) => {
    setEditState(prev => ({
      values: { ...prev.values, [field]: value },
      baseline: field in prev.baseline ? prev.baseline : { ...prev.baseline, [field]: baseDraft[field] },
    }));
  };

  /** What the lane playbook put in the form, so another lane can swap it but never Pat's own edit. */
  const [laneFilled, setLaneFilled] = useState<Partial<Pick<DealEditDraft, 'followup_date' | 'next_action'>>>({});

  const clearEdits = () => {
    setEditState({ values: {}, baseline: {} });
    setLaneFilled({});
  };

  const unsetField = (field: DealEditField) => {
    setEditState(prev => {
      const values = { ...prev.values };
      const baseline = { ...prev.baseline };
      delete values[field];
      delete baseline[field];
      return { values, baseline };
    });
  };

  // Picking a lane fills in its playbook date and next action (lane-playbook.ts); going back
  // to the deal's own lane takes them out. A date already on the deal is never replaced.
  const chooseLane = (target: DealWorkflowAction) => {
    setField('workflow_action', target);
    const prefill = target === currentWorkflow ? null : lanePrefill(deal, target, today);
    const fills = {
      followup_date: prefill?.dateIsDefault ? prefill.followupDate : null,
      next_action: prefill?.nextAction ?? null,
    };
    const filled: typeof laneFilled = {};
    for (const field of ['followup_date', 'next_action'] as const) {
      const ownEdit = field in editState.values && editState.values[field] !== laneFilled[field];
      if (ownEdit) continue;
      const value = fills[field];
      if (value) {
        setField(field, value);
        filled[field] = value;
      } else {
        unsetField(field);
      }
    }
    setLaneFilled(filled);
  };

  const toggleEditing = () => {
    if (editing) clearEdits();
    setEditing(value => !value);
  };

  const keepSavedValuesForConflicts = () => {
    setEditState(prev => {
      const values = { ...prev.values };
      const baseline = { ...prev.baseline };
      conflicts.forEach(field => {
        delete values[field];
        delete baseline[field];
      });
      return { values, baseline };
    });
  };

  const beforeSnapshot = (): Partial<Deal> => ({
    stage: deal.stage,
    product: deal.product,
    priority: deal.priority,
    value: deal.value,
    workflow_action: currentWorkflow,
    sample_status: deal.sample_status || null,
    nudge_stage: deal.nudge_stage || null,
    next_action: deal.next_action,
    draft_primary_ask: deal.draft_primary_ask || null,
    followup_date: deal.followup_date,
    last_outcome: deal.last_outcome,
    buyer_reply: deal.buyer_reply || null,
    lost_reason: deal.lost_reason || null,
    park_reason: deal.park_reason || null,
    won_note: deal.won_note || null,
    close_date: deal.close_date || null,
  });

  const validateWorkflow = () => {
    if (editData.workflow_action === 'sample' && !editData.sample_status) {
      return 'Choose whether the sample was sent or received.';
    }
    if (editData.workflow_action === 'testing' && !editData.followup_date) {
      return 'Set the client testing date before saving.';
    }
    if (editData.workflow_action === 'reschedule' && !editData.followup_date) {
      return 'Set the follow-up date.';
    }
    return null;
  };

  const persistSave = async () => {
    const workflowError = validateWorkflow();
    if (workflowError) {
      setError(workflowError);
      return;
    }

    const editedFields = new Set(Object.keys(editState.values) as DealEditField[]);
    const actionToSave = editData.workflow_action as DealWorkflowAction;
    const workflowChanged = editedFields.has('workflow_action') && actionToSave !== currentWorkflow;
    const workflow = WORKFLOW_BY_ID[actionToSave];
    const laneDetail =
      workflowChanged && actionToSave === 'sample' && editData.sample_status
        ? ` — sample ${editData.sample_status}`
        : '';

    const payload = buildDealEditPayload({
      deal,
      draft: editData,
      editedFields,
      laneJournalEntry: workflowChanged
        ? `${workflow.icon} Workflow set to ${workflow.label}${laneDetail}`
        : undefined,
    });

    // Nothing typed means nothing written — never a fake success.
    if (isEmptyPayload(payload)) {
      clearEdits();
      setEditing(false);
      setError(null);
      addToast('No changes to save');
      return;
    }

    setSaving(true);
    setError(null);
    const before = beforeSnapshot();

    try {
      // Version-checked so two writes cannot silently overwrite one another; a lost
      // response is safe to retry because an already-applied change is detected.
      const updated = await crm.updateDealIfUnchanged(deal.id, deal.updated_at, payload);

      clearEdits();
      setUndoSnapshot(before);
      setEditing(false);
      logActivity({
        type: 'edit',
        entity: 'deal',
        entityId: deal.id,
        label: workflowChanged ? `${workflow.icon} ${workflow.label}` : `Updated ${dealClientName(deal, companies, contacts)}`,
        description: workflowChanged
          ? `${dealClientName(deal, companies, contacts)} moved to the ${workflow.shortLabel} lane`
          : `Fields updated: ${[...editedFields].filter(f => f !== 'last_outcome_new').join(', ') || 'note added'}`,
        undoPayload: before,
      });
      onSaved();
      setSaved(true);
      addToast(workflowChanged ? 'Action lane updated' : 'Deal saved!');
      setTimeout(() => setSaved(false), 2000);
      void updated;
    } catch (err: any) {
      setError('Could not save: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  /** One-tap follow-up reschedule from today: +1d / +3d / next week. */
  const snoozeFollowup = async (days: number) => {
    const target = new Date();
    target.setDate(target.getDate() + days);
    const followup_date = localDateKey(target);
    setSaving(true);
    setError(null);
    const before = beforeSnapshot();
    try {
      await crm.updateDealIfUnchanged(deal.id, deal.updated_at, { followup_date });
      setUndoSnapshot(before);
      logActivity({
        type: 'edit',
        entity: 'deal',
        entityId: deal.id,
        label: 'Follow-up snoozed',
        description: `${dealClientName(deal, companies, contacts)} follow-up moved to ${followup_date}`,
        undoPayload: before,
      });
      onSaved();
      addToast('Follow-up updated');
    } catch (err: any) {
      setError('Could not save: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleExitConfirm = async (payload: ExitDealPayload) => {
    const before = beforeSnapshot();
    const { updates, error: closeError, recordOrderAmount } = buildCloseUpdate(deal, {
      kind: payload.kind,
      close_date: payload.close_date,
      won_note: payload.won_note,
      value: payload.value,
      lost_reason: payload.lost_reason,
      followup_date: payload.followup_date,
      park_reason: payload.park_reason,
      action: payload.action ?? null,
    });
    if (closeError) {
      setError(closeError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await crm.closeDealWithOrderIfUnchanged({
        dealId: deal.id,
        expectedUpdatedAt: deal.updated_at,
        updates,
        order: payload.kind === 'won' && deal.company_id && recordOrderAmount != null
          ? {
              companyId: deal.company_id,
              eventDate: payload.close_date || localDateKey(),
              amount: recordOrderAmount,
              productLine: deal.product || null,
            }
          : null,
      });

      const exitCopy =
        payload.kind === 'won'
          ? { label: '🎉 Marked won', description: `${dealClientName(deal, companies, contacts)} marked won`, toast: 'Deal marked won' }
          : payload.kind === 'lost'
            ? { label: '📉 Marked lost', description: `${dealClientName(deal, companies, contacts)} marked lost (${payload.lost_reason})`, toast: 'Deal marked lost' }
            : { label: '⏸ Parked', description: `${dealClientName(deal, companies, contacts)} parked until ${payload.followup_date}`, toast: 'Deal parked' };

      logActivity({
        type: 'edit',
        entity: 'deal',
        entityId: deal.id,
        label: exitCopy.label,
        description: exitCopy.description,
        undoPayload: before,
      });
      addToast(exitCopy.toast);
      setUndoSnapshot(before);
      setExitKind(null);
      onSaved();
      onClose();
    } catch (err: any) {
      if (err instanceof crm.OrderRecordPendingError) {
        logActivity({
          type: 'edit',
          entity: 'deal',
          entityId: deal.id,
          label: '🎉 Marked won',
          description: `${dealClientName(deal, companies, contacts)} marked won; order record pending retry`,
          undoPayload: before,
        });
        addToast('Deal marked won; order record needs retry.', 'error', {
          label: 'Retry',
          onClick: () => {
            void crm.recordOrderForClosedDeal(deal.id, err.order)
              .then(() => addToast('Order record saved'))
              .catch(() => addToast('Order record still needs retry.', 'error'));
          },
        });
        setUndoSnapshot(before);
        setExitKind(null);
        onSaved();
        onClose();
        return;
      }
      setError('Could not save: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async () => {
    if (!undoSnapshot) return;
    setSaving(true);
    setError(null);
    try {
      await crm.updateDeal(deal.id, undoSnapshot);
      setUndoSnapshot(null);
      onSaved();
      addToast('Change undone');
    } catch (err: any) {
      setError('Could not undo: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const linkedContact = useMemo(() => {
    if (!deal.contact_ids?.length) return null;
    return contacts.find(c => deal.contact_ids.includes(c.id)) || null;
  }, [deal.contact_ids, contacts]);

  const outreachLanguage = linkedContact?.outreach_language ?? 'autodetect';
  const outreachBasis = linkedContact?.outreach_language_basis ?? 'autodetect';

  const lastInbound = useMemo(() => {
    if (!linkedContact) return null;
    const contactMeetings = meetings
      .filter(m => (m.contact_ids || []).includes(linkedContact.id) && m.outcome && m.outcome !== 'no_response')
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return contactMeetings[0] || null;
  }, [linkedContact, meetings]);

  const lastTouch = useMemo(() => {
    const dealMeetings = meetings
      .filter(m => m.deal_id === deal.id)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return dealMeetings[0] || null;
  }, [meetings, deal.id]);

  const handleDraftLanguageSelect = async (lang: OutreachLanguage) => {
    setDraftLanguage(lang);
    if (linkedContact && lang !== 'autodetect') {
      try {
        await crm.updateContact(linkedContact.id, {
          outreach_language: lang,
          outreach_language_basis: 'pat_override',
        });
        addToast(`Language set to ${outreachLanguageLabel(lang).replace(/[^\w\s]/g, '').trim()}`);
      } catch {
        addToast('Could not save language override');
      }
    }
  };

  const isOverdue =
    deal.followup_date &&
    new Date(`${deal.followup_date}T12:00:00`) < new Date() &&
    !['closed_won', 'closed_lost'].includes(deal.stage);
  const workflow = WORKFLOW_BY_ID[currentWorkflow];
  // Reads the merged draft, so the form always shows the latest record plus the
  // user's own edits — never the lane the deal has already left.
  const visibleNextAction = editData.next_action;
  // The lane playbook behind a lane picked in the editor, for the hints under its fields.
  const lanePlaybook = editing && editData.workflow_action !== currentWorkflow ? lanePrefill(deal, editData.workflow_action, today) : null;
  const isClosed = deal.stage === 'closed_won' || deal.stage === 'closed_lost';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-stretch md:justify-end" role="dialog" aria-modal="true" aria-label="Deal details">
      <motion.div
        className="absolute inset-0 bg-black/35"
        variants={overlayVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={tweenBase}
        onClick={onClose}
      />
      <motion.div
        className={clsx('relative w-full rounded-t-2xl bg-white p-6 dark:bg-clay-card md:h-dvh md:max-h-dvh md:max-w-[480px] md:rounded-none md:border-l md:border-clay-hairline max-h-[86vh] overflow-y-auto', saving ? 'opacity-80' : saved ? 'ring-2 ring-clay-success/40' : '')}
        variants={panelVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={tweenSlow}
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <CompanyLogo src={dealCompany?.logo_url} name={dealClientName(deal, companies, contacts)} id={deal.company_id} size={36} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-clay-ink">{dealClientName(deal, companies, contacts)}</h2>
            {headerFacts && <p className="truncate text-xs text-clay-muted">{headerFacts}</p>}
          </div>
          <div className="relative flex shrink-0 items-center">
            {editing && (
              <button onClick={persistSave} disabled={saving} className="rounded-lg p-2 text-clay-success hover:bg-clay-surface disabled:opacity-50" aria-label="Save deal">
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              </button>
            )}
            <button onClick={toggleEditing} className="rounded-lg p-2 text-clay-muted hover:bg-clay-surface hover:text-clay-ink" aria-label="Edit deal">
              <Edit2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setMenuOpen(open => !open)}
              aria-label="More actions"
              aria-expanded={menuOpen}
              className="rounded-lg p-2 text-clay-muted hover:bg-clay-surface hover:text-clay-ink"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              // Tapping anywhere else closes the menu.
              <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setMenuOpen(false)} />
            )}
            {menuOpen && (
              <div className="absolute right-8 top-10 z-20 min-w-40 rounded-lg border border-clay-hairline bg-white py-1 shadow-lg dark:bg-clay-card">
                <button
                  onClick={() => { setMenuOpen(false); setConfirmArchive(true); }}
                  className="w-full px-3 py-2 text-left text-sm text-clay-error hover:bg-clay-surface"
                  aria-label="Archive deal"
                >
                  Archive deal
                </button>
              </div>
            )}
            <button onClick={onClose} className="rounded-lg p-2 text-clay-muted hover:bg-clay-surface hover:text-clay-ink" aria-label="Close">
              <X className="h-5 w-5" />
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
          <div className="mb-4 flex items-center gap-2 text-sm text-clay-success">
            <Check className="w-4 h-4" />
            Saved
          </div>
        )}
        {error && !saving && <div className="mb-4 rounded-lg bg-clay-error/10 px-3 py-2 text-sm text-clay-error">{error}</div>}

        {editing && conflicts.length > 0 && (
          <div role="status" className="mb-4 rounded-lg border border-clay-ochre/40 bg-clay-ochre/15 px-3 py-2 text-xs text-clay-ochre">
            <p className="font-medium">
              This deal changed while you were editing: {conflicts.map(dealEditFieldLabel).join(', ')}.
            </p>
            <p className="mt-0.5">Your unsaved value is kept. Saving writes your version over the newer record.</p>
            <button type="button" onClick={keepSavedValuesForConflicts} className="mt-1.5 underline">
              Use the latest saved values
            </button>
          </div>
        )}

        <div className="space-y-4 text-sm">
          {/* Status: stage, nudge, sample milestone, last touch — one line. */}
          <section data-deal-primary>
            {editing ? (
              <>
                <select
                  aria-label="Action lane"
                  value={editData.workflow_action}
                  onChange={event => chooseLane(event.target.value as DealWorkflowAction)}
                  className="w-full px-3 py-2.5 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card"
                >
                  {WORKFLOW_LANES.map(lane => (
                    <option key={lane.id} value={lane.id}>
                      {lane.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-clay-muted mt-2">{WORKFLOW_BY_ID[editData.workflow_action].description}</p>
                {(editData.workflow_action === 'sample' || editData.workflow_action === 'testing') && (
                  <label className="block mt-3 text-xs text-clay-body">
                    Sample status
                    <select
                      value={editData.sample_status}
                      onChange={event => setField('sample_status', event.target.value as SampleStatus)}
                      className="w-full mt-1 px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card"
                    >
                      <option value="">Choose status</option>
                      {SAMPLE_STATUS_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-clay-lavender/20 px-2 py-1 font-medium text-clay-ink" title={workflow.description}>
                  <span className="h-1.5 w-1.5 rounded-full bg-clay-teal" aria-hidden="true" />
                  {workflow.label}
                </span>
                {derived && (
                  <span className={clsx('rounded-md border px-2 py-0.5 font-semibold', nudgeColorClass(derived.stage))}>
                    {nudgeChipLabel(formatDerivedNudgeBadge(derived))}
                  </span>
                )}
                {deal.sample_status && (
                  <span className="rounded-md bg-clay-ochre/15 px-2 py-1 text-clay-ochre">
                    {deal.sample_status === 'sent' ? 'Sample sent' : 'Received by client'}
                  </span>
                )}
                {lastTouch && (
                  <span className="ml-auto text-clay-muted">
                    Last touch · {lastTouch.type === 'dm' ? 'DM' : lastTouch.type.charAt(0).toUpperCase() + lastTouch.type.slice(1)} · {formatScheduleDate(lastTouch.date).replace(/ \d{4}$/, '')}
                  </span>
                )}
              </div>
            )}
          </section>

          <section>
            <p className="text-xs text-clay-muted">Next action</p>
            {editing ? (
              <label className="block">
                <span className="sr-only">Next action</span>
                <input
                  aria-label="Next action"
                  value={editData.next_action}
                  onChange={event => setField('next_action', event.target.value)}
                  placeholder="Start with a verb: follow up, ask, send, confirm…"
                  className="mt-1 w-full rounded-lg border border-clay-hairline bg-transparent px-3 py-2 text-base"
                />
                {laneFilled.next_action && editData.next_action === laneFilled.next_action && deal.next_action?.trim() && deal.next_action.trim() !== laneFilled.next_action && (
                  <span className="mt-1 block truncate text-xs text-clay-muted">Replaces: {deal.next_action}</span>
                )}
              </label>
            ) : (
              <p className={clsx('mt-0.5 text-[15px] leading-snug', deal.next_action ? 'text-clay-ink' : 'italic text-clay-muted')}>
                {deal.next_action || 'No next action set yet'}
              </p>
            )}
            {isPassiveNextAction(visibleNextAction) && (
              <p role="alert" className="mt-1.5 flex items-start gap-2 rounded-lg border border-clay-ochre/40 bg-clay-ochre/15 px-2.5 py-2 text-xs font-medium text-clay-ochre">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Needs a concrete action: start with follow up, ask, send, or confirm.</span>
              </p>
            )}
          </section>

          <section>
            {editing ? (
              <label className="block text-xs text-clay-muted">
                {editData.workflow_action === 'testing' ? 'Testing date' : 'Follow-up date'}
                <input
                  type="date"
                  value={editData.followup_date}
                  onChange={event => setField('followup_date', event.target.value)}
                  className="mt-1 block rounded-lg border border-clay-hairline bg-transparent px-3 py-2 text-base text-clay-ink"
                />
                {lanePlaybook?.defaultDate && editData.followup_date === lanePlaybook.defaultDate && (
                  <span data-lane-date-hint className="mt-1 block">+{lanePlaybook.days} days · {WORKFLOW_BY_ID[editData.workflow_action].shortLabel} default</span>
                )}
                {lanePlaybook?.defaultDate && !lanePlaybook.dateIsDefault && editData.followup_date === deal.followup_date && editData.followup_date !== lanePlaybook.defaultDate && (
                  <span data-lane-date-hint className="mt-1 block">
                    The deal&apos;s date is kept.{' '}
                    <button type="button" onClick={() => setField('followup_date', lanePlaybook.defaultDate!)} className="underline decoration-clay-hairline underline-offset-2 hover:text-clay-ink">
                      Use +{lanePlaybook.days} days
                    </button>
                  </span>
                )}
              </label>
            ) : (
              <p className="text-xs text-clay-muted">
                Follow-up ·{' '}
                <span className={clsx(isOverdue ? 'font-medium text-clay-error' : 'text-clay-ink')}>
                  {deal.followup_date
                    ? `${deal.followup_date === today ? 'today, ' : ''}${formatScheduleDate(deal.followup_date).replace(/ \d{4}$/, '')}`
                    : 'not set'}
                </span>
              </p>
            )}
            {!editing && !isClosed && (
              <div className="mt-2 flex flex-wrap gap-2">
                {[{ days: 1, label: '+1 day' }, { days: 3, label: '+3 days' }, { days: 7, label: 'Next week' }].map(chip => (
                  <button
                    key={chip.days}
                    type="button"
                    onClick={() => void snoozeFollowup(chip.days)}
                    disabled={saving}
                    className="h-8 rounded-lg border border-clay-hairline px-3 text-xs text-clay-body hover:border-clay-ink/30 hover:text-clay-ink disabled:opacity-50"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
          </section>

          {!isClosed && (
            <button
              type="button"
              onClick={() => setLogOpen(true)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-clay-ink text-sm font-medium text-clay-canvas hover:opacity-90"
            >
              <MessageCircle className="h-4 w-4" />
              Log touch
            </button>
          )}

          {!isClosed && !editing && <QuickReplyBox deal={deal} />}

          {!editing && <DealTimeline deal={deal} />}

          {/* Everything else in three folds: Details, Draft, History. Editing opens them so every field is reachable. */}
          <div className="border-t border-clay-hairline">
            <PanelSection title="Details" open={editing}>
              <div className="space-y-4">
            {!isClosed && (
              <div className="border-b border-clay-hairline">
                <LayaGradePanel deal={deal} />
                <DealFactsPanel deal={deal} />
              </div>
            )}
              <SubHeading>Account and buyer map</SubHeading>
              <div className="space-y-3">
                {dealCompany && (
                  <AccountSourceField
                    key={dealCompany.id}
                    company={dealCompany}
                    onSave={patch => crm.updateCompany(dealCompany.id, patch)
                      .then(() => { addToast('Saved to the account'); onSaved(); })
                      .catch(() => addToast('Could not save to the account', 'error'))}
                  />
                )}
                <LayaScoreCard deal={deal} company={dealCompany} />
                {dealCompany && (
                  <StakeholderMiniMap
                    company={dealCompany}
                    companyName={dealCompany.name}
                    productHint={deal.product}
                    onUpdated={onSaved}
                  />
                )}
              </div>
              <SubHeading>Commercial details</SubHeading>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-clay-body">
                Product
                {editing ? (
                  <input value={editData.product} onChange={event => setField('product', event.target.value)} className="w-full mt-1 px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card" />
                ) : (
                  <p className="mt-1 text-clay-ink">{deal.product}</p>
                )}
              </label>
              <label className="text-clay-body">
                Priority
                {editing ? (
                  <select value={editData.priority} onChange={event => setField('priority', event.target.value as Deal['priority'])} className="w-full mt-1 px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card">
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                ) : (
                  <span className="block mt-1 px-2 py-1.5 bg-clay-card rounded text-xs capitalize">{deal.priority}</span>
                )}
              </label>
              <label className="text-clay-body">
                Value (THB)
                {editing ? (
                  <input type="text" inputMode="decimal" value={editData.value} onChange={event => setField('value', event.target.value)} placeholder="e.g., 50000" className="w-full mt-1 px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card" />
                ) : (
                  <p className="mt-1 font-medium text-clay-ink">{deal.value != null ? Number(deal.value).toLocaleString('en-US') : '—'}</p>
                )}
              </label>
            </div>
              </div>
            </PanelSection>
            <PanelSection title="Draft" open={editing}>
              <div className="space-y-4">
            {!isClosed && (
                <MessageDraft
                  deal={deal}
                  company={dealCompany}
                  contacts={contacts}
                  sendCount={sendCount}
                  onSaveApplication={dealCompany ? value => {
                    crm.updateCompany(dealCompany.id, { what_they_make: value || null })
                      .then(() => { addToast('Saved to the account'); onSaved(); })
                      .catch(() => addToast('Could not save to the account', 'error'));
                  } : undefined}
                  onLog={(channel, notes) => { setLogPrefill({ channel, notes }); setLogOpen(true); }}
                />
            )}
            <SubHeading>Drafting brief</SubHeading>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold tracking-wider text-clay-muted">PRIMARY CLIENT ASK</p>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] border ${outreachLanguageBadgeColor(outreachLanguage)}`}>
                  {outreachLanguageLabel(outreachLanguage)}
                </span>
              </div>
              <p className="text-xs text-clay-muted">One client question only. This is drafting guidance, not a send instruction.</p>
              {editing ? (
                <input
                  value={editData.draft_primary_ask}
                  onChange={event => setField('draft_primary_ask', event.target.value)}
                  placeholder="What one thing should the client answer?"
                  className="w-full px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card"
                />
              ) : (
                <p className="rounded-lg bg-white/60 dark:bg-clay-card p-3 text-xs text-clay-body">{deal.draft_primary_ask || '—'}</p>
              )}

              {outreachLanguage === 'autodetect' && (
                <div>
                  <p className="text-[10px] font-semibold tracking-wider text-clay-muted mb-1.5">DRAFT LANGUAGE</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleDraftLanguageSelect('thai')}
                      className={clsx(
                        'px-3 py-2 rounded-lg border text-xs font-medium transition-colors',
                        draftLanguage === 'thai' ? 'border-clay-ochre bg-clay-ochre/20 text-clay-ochre' : 'border-clay-hairline text-clay-muted'
                      )}
                    >
                      🇹🇭 Draft in Thai
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDraftLanguageSelect('english')}
                      className={clsx(
                        'px-3 py-2 rounded-lg border text-xs font-medium transition-colors',
                        draftLanguage === 'english' ? 'border-clay-lavender bg-clay-lavender/20 text-clay-lavender' : 'border-clay-hairline text-clay-muted'
                      )}
                    >
                      🇬🇧 Draft in English
                    </button>
                  </div>
                </div>
              )}

              {outreachLanguage !== 'autodetect' && outreachBasis && (
                <p className="text-[10px] text-clay-muted">
                  Language: {outreachLanguageLabel(outreachLanguage)} · {outreachLanguageBasisLabel(outreachBasis)}
                </p>
              )}

              <button type="button" onClick={() => setInboundContextOpen(!inboundContextOpen)} className="text-[10px] text-clay-muted underline">
                {inboundContextOpen ? 'Hide' : 'Show'} last inbound context
              </button>
              {inboundContextOpen && (
                <div className="rounded-lg bg-clay-surface p-2.5 text-[11px] text-clay-body leading-relaxed">
                  {lastInbound ? (
                    <>
                      <p className="text-clay-muted text-[10px] mb-1">
                        {lastInbound.date} · {lastInbound.type}
                      </p>
                      <p>{lastInbound.summary || lastInbound.description}</p>
                    </>
                  ) : (
                    <p className="text-clay-muted">No inbound message on record — auto-detect.</p>
                  )}
                </div>
              )}
            </div>
              </div>
            </PanelSection>
            {(editing || deal.last_outcome || deal.buyer_reply) && (
              <PanelSection title="History" open={editing}>
            <label className="block text-xs text-clay-body">
              Latest buyer reply (verbatim)
              {editing ? (
                <textarea
                  aria-label="Latest buyer reply (verbatim)"
                  value={editData.buyer_reply}
                  onChange={event => setField('buyer_reply', event.target.value)}
                  rows={3}
                  placeholder="Paste the buyer’s exact words here; keep this separate from your outcome note."
                  className="w-full mt-1 px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card resize-y"
                />
              ) : (
                <span className="mt-1 block whitespace-pre-wrap rounded-lg bg-clay-surface p-3 text-xs leading-relaxed">
                  {deal.buyer_reply || 'No verbatim buyer reply recorded.'}
                </span>
              )}
              {editing && <span className="mt-1 block text-[10px] text-clay-muted">Keep the exact buyer message; paraphrases belong in Outcome history and will not be sent to Laya.</span>}
            </label>
            {editing ? (
              <textarea
                value={editData.last_outcome_new}
                onChange={event => setField('last_outcome_new', event.target.value)}
                rows={3}
                placeholder="Add a note — the date will be recorded automatically"
                className="w-full mt-1 px-3 py-2 border border-clay-hairline rounded-lg text-base bg-white dark:bg-clay-card resize-none"
              />
            ) : null}
            <div className="mt-1 rounded-lg bg-clay-surface p-3 text-xs text-clay-body leading-relaxed space-y-2">
              {deal.last_outcome
                ? deal.last_outcome
                    .split('\n---\n')
                    .map((entry, index) => (
                      <p key={index} className="border-b border-clay-hairline/60 pb-2 last:border-0 last:pb-0">
                        {entry}
                      </p>
                    ))
                : 'No outcomes recorded yet.'}
              {editing && editData.last_outcome_new.trim() && (
                <p className="border-t border-dashed border-clay-hairline pt-2 text-clay-muted">
                  Pending when you save: {editData.last_outcome_new.trim()}
                </p>
              )}
            </div>
              </PanelSection>
            )}
          </div>

          {!isClosed && currentWorkflow !== 'parked' && (
            <div className="flex flex-wrap items-center gap-x-1 text-xs text-clay-muted">
              <span className="mr-1">Close deal</span>
              <button type="button" onClick={() => setExitKind('won')} className="rounded-md px-2 py-1 font-medium text-clay-teal hover:bg-clay-surface dark:text-clay-mint">Won</button>
              <button type="button" onClick={() => setExitKind('lost')} className="rounded-md px-2 py-1 font-medium text-clay-error hover:bg-clay-surface">Lost</button>
              <button type="button" onClick={() => setExitKind('park')} className="rounded-md px-2 py-1 font-medium text-clay-body hover:bg-clay-surface">Park</button>
            </div>
          )}

          {undoSnapshot && (
            <button onClick={handleUndo} disabled={saving} className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-clay-hairline bg-clay-surface text-sm font-medium text-clay-muted active:scale-[0.98] disabled:opacity-50">
              <Undo2 className="w-4 h-4" />
              Undo last change
            </button>
          )}
        </div>

        {confirmArchive && (
          <div className="mt-4 rounded-xl border border-clay-hairline bg-clay-surface p-4">
            <div className="flex gap-3">
              <span className="text-2xl">🗑️</span>
              <div>
                <p className="font-semibold text-clay-ink">Archive this deal?</p>
                <p className="text-xs text-clay-muted mt-1">{dealClientName(deal, companies, contacts)} will be hidden from the board and lists.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button
                onClick={() => {
                  setConfirmArchive(false);
                  setSaving(true);
                  deleteEntity('deal', deal.id, dealClientName(deal, companies, contacts))
                    .then(() => {
                      setSaving(false);
                      addToast('Deal archived');
                      onClose();
                    })
                    .catch(err => {
                      setSaving(false);
                      setError('Could not archive: ' + (err.message || 'Unknown error'));
                    });
                }}
                className="px-3 py-2.5 bg-clay-error text-white text-sm font-medium rounded-lg"
              >
                Archive
              </button>
              <button onClick={() => setConfirmArchive(false)} className="px-3 py-2.5 bg-clay-card text-clay-ink text-sm font-medium rounded-lg">
                Cancel
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {logOpen && (
        <LogInteractionModal
          isOpen={logOpen}
          onClose={() => { setLogOpen(false); setLogPrefill(null); }}
          // Persist the interaction ONLY. The modal owns closing, its success toast, and its
          // partial-failure/retry state — closing it here would destroy the very error surface
          // that tells the user half the action saved.
          onSave={async meeting => {
            await addMeeting(meeting);
            onSaved();
          }}
          deals={[deal]}
          contacts={contacts}
          companies={companies}
          selectedDealId={deal.id}
          initialChannel={logPrefill?.channel}
          initialNotes={logPrefill?.notes}
        />
      )}

      {exitKind && (
        <ExitDealModal deal={deal} kind={exitKind} onCancel={() => setExitKind(null)} onConfirm={handleExitConfirm} />
      )}
    </div>
  );
}

/** A small heading inside a fold. */
function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-clay-ink">{children}</h3>;
}

/** A quiet disclosure row. `open` forces it open (while editing, so every field is reachable). */
function PanelSection({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="group border-b border-clay-hairline" open={open || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm text-clay-ink marker:hidden">
        {title}
        <ChevronRight className="h-4 w-4 text-clay-muted transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <div className="pb-4 text-sm">{children}</div>
    </details>
  );
}
