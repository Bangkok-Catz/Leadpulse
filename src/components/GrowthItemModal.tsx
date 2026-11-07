'use client';

import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Archive, ExternalLink, Save, TrendingUp, X } from 'lucide-react';
import ModalShell from '@/components/motion/ModalShell';
import { focusRing } from '@/components/GrowthRow';
import * as growth from '@/lib/growth';
import {
  CLOSED_LABELS,
  GROWTH_KIND_LABELS,
  KINDS_BY_TRACK,
  STAGE_LABELS,
  TRACK_LABELS,
  draftFromItem,
  emptyGrowthDraft,
  normalizeGrowthDraft,
  shortDay,
  type GrowthDraft,
  type GrowthItem,
  type GrowthStatus,
  type GrowthTrack,
  type GrowthUpdate,
} from '@/utils/growth';

const input = 'w-full rounded-lg border border-clay-hairline bg-white px-3 py-3 text-base text-clay-ink focus:outline-none focus:ring-2 focus:ring-clay-ink dark:bg-clay-card';

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-clay-body">{text}</span>
      {children}
    </label>
  );
}

interface GrowthItemModalProps {
  open: boolean;
  onClose: () => void;
  /** the row to edit; null adds a new one */
  item: GrowthItem | null;
  /** the tab a new row goes on */
  track: GrowthTrack;
  onSaved: () => void;
  onArchive: (item: GrowthItem) => void;
}

/** Add a funding or PR row, or open one: edit it, see what was logged, close or archive it. */
export default function GrowthItemModal(props: GrowthItemModalProps) {
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell
      open={props.open}
      onClose={props.onClose}
      lockDismiss={saving}
      panelClassName="bg-white dark:bg-clay-card md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
    >
      {/* Mounted per opening, so each opening starts from the row as saved. */}
      {props.open && <GrowthItemForm key={props.item?.id ?? `new-${props.track}`} {...props} saving={saving} setSaving={setSaving} />}
    </ModalShell>
  );
}

function GrowthItemForm({
  onClose,
  item,
  track,
  onSaved,
  onArchive,
  saving,
  setSaving,
}: GrowthItemModalProps & { saving: boolean; setSaving: (saving: boolean) => void }) {
  const [draft, setDraft] = useState<GrowthDraft>(() => (item ? draftFromItem(item) : emptyGrowthDraft(track)));
  const [error, setError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<GrowthUpdate[] | null>(item ? null : []);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    growth.getGrowthUpdates(item.id).then(rows => { if (!cancelled) setUpdates(rows); }, () => { if (!cancelled) setUpdates([]); });
    return () => { cancelled = true; };
  }, [item]);

  const set = <K extends keyof GrowthDraft>(key: K, value: GrowthDraft[K]) => setDraft(d => ({ ...d, [key]: value }));
  const setTrack = (next: GrowthTrack) => setDraft(d => ({
    ...d,
    track: next,
    kind: KINDS_BY_TRACK[next].includes(d.kind) ? d.kind : KINDS_BY_TRACK[next][0],
  }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = normalizeGrowthDraft(draft);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    try {
      if (item) await growth.updateGrowthItem(item.id, result.payload);
      else await growth.createGrowthItem(result.payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: GrowthStatus) => {
    if (!item) return;
    setSaving(true);
    try {
      await growth.updateGrowthItem(item.id, status === 'open' ? { status } : { status, next_step: null, next_date: null, waiting_since: null });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const kinds = KINDS_BY_TRACK[draft.track].includes(draft.kind) ? KINDS_BY_TRACK[draft.track] : [draft.kind, ...KINDS_BY_TRACK[draft.track]];

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-clay-hairline bg-white p-4 dark:bg-clay-card">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-clay-ink text-clay-canvas"><TrendingUp className="h-5 w-5" aria-hidden="true" /></div>
          <h2 className="truncate text-lg font-semibold text-clay-ink">{item ? item.name : `Add to ${TRACK_LABELS[draft.track]}`}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={clsx('-mr-2 p-2 text-clay-muted hover:text-clay-ink', focusRing)}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={save} className="space-y-4 p-4">
        <div role="radiogroup" aria-label="Tab" className="flex gap-1.5">
          {(['funding', 'pr'] as const).map(t => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={draft.track === t}
              onClick={() => setTrack(t)}
              className={clsx(
                'inline-flex h-8 items-center rounded-lg border px-3 text-sm transition-colors',
                draft.track === t ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
                focusRing,
              )}
            >
              {TRACK_LABELS[t]}
            </button>
          ))}
        </div>

        <Label text="Name *">
          <input className={input} value={draft.name} onChange={e => set('name', e.target.value)} placeholder={draft.track === 'pr' ? 'e.g. Brand Buffet' : 'e.g. Big Idea Ventures'} required />
        </Label>

        <div className="grid grid-cols-2 gap-3">
          <Label text="What it is">
            <select className={input} value={draft.kind} onChange={e => set('kind', e.target.value as GrowthDraft['kind'])}>
              {kinds.map(kind => <option key={kind} value={kind}>{GROWTH_KIND_LABELS[kind]}</option>)}
            </select>
          </Label>
          <Label text="Stage">
            <select className={input} value={draft.stage} onChange={e => set('stage', Number(e.target.value))}>
              {STAGE_LABELS[draft.track].map((label, i) => <option key={label} value={i + 1}>{i + 1} · {label}</option>)}
            </select>
          </Label>
        </div>

        <Label text={draft.track === 'pr' ? 'Angle or format' : 'What it gives'}>
          <input className={input} value={draft.offer} onChange={e => set('offer', e.target.value)} placeholder={draft.track === 'pr' ? 'e.g. Founder story' : 'e.g. Grant, Equity, US$100k prize'} />
        </Label>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <Label text="Next step">
            <input className={input} value={draft.next_step} onChange={e => set('next_step', e.target.value)} placeholder="e.g. Progress report" />
          </Label>
          <Label text="By">
            <input type="date" className={input} value={draft.next_date} onChange={e => set('next_date', e.target.value)} />
          </Label>
        </div>

        <Label text="Website">
          <input className={input} value={draft.url} onChange={e => set('url', e.target.value)} placeholder="e.g. nia.or.th" inputMode="url" />
        </Label>

        <Label text="Notes">
          <textarea className={clsx(input, 'resize-none')} rows={3} value={draft.note} onChange={e => set('note', e.target.value)} />
        </Label>

        {item && (
          <section aria-labelledby="growth-history" className="rounded-lg bg-clay-surface px-3 py-2.5">
            <h3 id="growth-history" className="text-xs font-semibold text-clay-ink">What happened</h3>
            {updates === null ? (
              <p className="mt-1 text-xs text-clay-muted">Loading…</p>
            ) : updates.length === 0 ? (
              <p className="mt-1 text-xs text-clay-muted">Nothing logged yet.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {updates.map(u => (
                  <li key={u.id} className="flex gap-2 text-xs text-clay-body">
                    <span className="w-[74px] shrink-0 tabular-nums text-clay-muted">{shortDay(u.happened_on)}</span>
                    <span className="min-w-0 whitespace-pre-line">{u.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {item && (
          <div className="flex flex-wrap items-center gap-2">
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className={clsx('inline-flex h-9 items-center gap-1.5 rounded-lg border border-clay-hairline px-3 text-xs font-medium text-clay-ink hover:border-clay-lavender', focusRing)}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open site
              </a>
            )}
            {item.status === 'open' ? (
              <>
                <span className="text-xs text-clay-muted">Close as</span>
                {(['done', 'missed', 'declined'] as const).map(status => (
                  <button key={status} type="button" disabled={saving} onClick={() => setStatus(status)} className={clsx('h-9 rounded-lg border border-clay-hairline px-3 text-xs font-medium text-clay-ink hover:border-clay-lavender', focusRing)}>
                    {CLOSED_LABELS[status]}
                  </button>
                ))}
              </>
            ) : (
              <button type="button" disabled={saving} onClick={() => setStatus('open')} className={clsx('h-9 rounded-lg border border-clay-hairline px-3 text-xs font-medium text-clay-ink hover:border-clay-lavender', focusRing)}>
                Reopen
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => { onArchive(item); onClose(); }}
              className={clsx('ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-clay-muted hover:text-clay-ink', focusRing)}
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Archive
            </button>
          </div>
        )}

        {error && <div role="alert" className="rounded-lg bg-clay-error/10 px-3 py-2 text-sm text-clay-error">{error}</div>}

        <div className="flex items-center gap-3 pb-4 pt-2">
          <button type="submit" disabled={saving} className="motion-press flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-clay-ink px-4 py-3 text-sm font-medium text-clay-canvas">
            <Save className="h-4 w-4" aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} className="motion-press min-h-[48px] rounded-lg bg-clay-card px-4 py-3 text-sm font-medium text-clay-ink">Cancel</button>
        </div>
      </form>
    </>
  );
}
