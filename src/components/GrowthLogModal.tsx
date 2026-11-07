'use client';

import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { MessageCircle, Save, X } from 'lucide-react';
import ModalShell from '@/components/motion/ModalShell';
import { focusRing } from '@/components/GrowthRow';
import * as growth from '@/lib/growth';
import { STAGE_LABELS, TRACK_LABELS, clampStage, planGrowthLog, type GrowthItem } from '@/utils/growth';

const input = 'w-full rounded-lg border border-clay-hairline bg-white px-3 py-3 text-base text-clay-ink focus:outline-none focus:ring-2 focus:ring-clay-ink dark:bg-clay-card';

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-clay-body">{text}</span>
      {children}
    </label>
  );
}

interface GrowthLogModalProps {
  open: boolean;
  onClose: () => void;
  /** open rows to choose from when no row is given */
  items: GrowthItem[];
  itemId: string | null;
  today: string;
  onSaved: () => void;
}

/** Log what happened on a funding or PR row, and set its next step. */
export default function GrowthLogModal(props: GrowthLogModalProps) {
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell
      open={props.open}
      onClose={props.onClose}
      lockDismiss={saving}
      panelClassName="bg-white dark:bg-clay-card md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
    >
      {/* Mounted per opening, so each opening starts from the row's current next step. */}
      {props.open && <GrowthLogForm key={props.itemId ?? 'any'} {...props} saving={saving} setSaving={setSaving} />}
    </ModalShell>
  );
}

function GrowthLogForm({
  onClose,
  items,
  itemId,
  today,
  onSaved,
  saving,
  setSaving,
}: GrowthLogModalProps & { saving: boolean; setSaving: (saving: boolean) => void }) {
  const choices = items.filter(i => i.status === 'open' && !i.deleted_at);
  const start = items.find(i => i.id === itemId) ?? choices[0] ?? null;
  const [chosen, setChosen] = useState<string>(start?.id ?? '');
  const [note, setNote] = useState('');
  const [stage, setStage] = useState(clampStage(start?.stage ?? 1));
  const [nextStep, setNextStep] = useState(start?.next_step ?? '');
  const [nextDate, setNextDate] = useState(start?.next_date ?? '');
  const [waiting, setWaiting] = useState(Boolean(start?.waiting_since));
  const [error, setError] = useState<string | null>(null);
  const item = items.find(i => i.id === chosen) ?? null;

  /** Picking another row brings in its stage and next step. */
  const choose = (id: string) => {
    const next = items.find(i => i.id === id);
    setChosen(id);
    setStage(clampStage(next?.stage ?? 1));
    setNextStep(next?.next_step ?? '');
    setNextDate(next?.next_date ?? '');
    setWaiting(Boolean(next?.waiting_since));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!item) {
      setError('Add a funding or PR row first.');
      return;
    }
    const log = planGrowthLog({ item, note, nextStep, nextDate, stage, waiting, today });
    setSaving(true);
    try {
      if (log.update) await growth.addGrowthUpdate(log.update);
      await growth.updateGrowthItem(item.id, log.patch);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-clay-hairline bg-white p-4 dark:bg-clay-card">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-clay-ink text-clay-canvas"><MessageCircle className="h-5 w-5" aria-hidden="true" /></div>
          <h2 className="truncate text-lg font-semibold text-clay-ink">{itemId && item ? `Log · ${item.name}` : 'Log update'}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={clsx('-mr-2 p-2 text-clay-muted hover:text-clay-ink', focusRing)}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={save} className="space-y-4 p-4">
        {!itemId && (
          <Label text="For">
            <select className={input} value={chosen} onChange={e => choose(e.target.value)}>
              {choices.map(i => <option key={i.id} value={i.id}>{i.name} · {TRACK_LABELS[i.track]}</option>)}
            </select>
          </Label>
        )}

        <Label text="What happened">
          <textarea className={clsx(input, 'resize-none')} rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Sent the progress report" autoFocus />
        </Label>

        {item && (
          <Label text="Stage">
            <select className={input} value={stage} onChange={e => setStage(Number(e.target.value))}>
              {STAGE_LABELS[item.track].map((label, i) => <option key={label} value={i + 1}>{i + 1} · {label}</option>)}
            </select>
          </Label>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <Label text="Next step">
            <input className={input} value={nextStep} onChange={e => setNextStep(e.target.value)} placeholder="e.g. Nudge about the deck" />
          </Label>
          <Label text="By">
            <input type="date" className={input} value={nextDate} onChange={e => setNextDate(e.target.value)} />
          </Label>
        </div>

        <label className="flex min-h-11 items-center gap-2.5 text-sm text-clay-body">
          <input type="checkbox" checked={waiting} onChange={e => setWaiting(e.target.checked)} className="h-4 w-4 accent-clay-ink" />
          Sent, waiting on them
        </label>

        {error && <div role="alert" className="rounded-lg bg-clay-error/10 px-3 py-2 text-sm text-clay-error">{error}</div>}

        <div className="flex items-center gap-3 pb-4 pt-2">
          <button type="submit" disabled={saving || !item} className="motion-press flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-clay-ink px-4 py-3 text-sm font-medium text-clay-canvas disabled:opacity-60">
            <Save className="h-4 w-4" aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} className="motion-press min-h-[48px] rounded-lg bg-clay-card px-4 py-3 text-sm font-medium text-clay-ink">Cancel</button>
        </div>
      </form>
    </>
  );
}
