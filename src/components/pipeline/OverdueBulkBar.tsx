'use client';

// ─── Bulk actions on the Overdue filter ───
// Acts on every overdue deal matching the current filters, including cards a capped lane
// hides (narrow them with search / product / priority first). Nothing is written without the confirm step; every deal goes through the same
// version check as a single edit and gets its own undo entry.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { Deal } from '@/types/crm';
import * as crm from '@/lib/crm';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import { planBulkPark, planBulkSnooze, type BulkItem } from '@/utils/bulk-overdue';
import { formatScheduleDate } from '@/utils/deal-schedule';

type Mode =
  | { kind: 'idle' }
  | { kind: 'snooze'; days: number }
  | { kind: 'park' };

const SNOOZE_OPTIONS = [{ days: 3, label: '+3 days' }, { days: 7, label: 'Next week' }];

export default function OverdueBulkBar({ deals, today, onDone, summary, note }: {
  deals: Deal[];
  today: string;
  onDone: () => Promise<void> | void;
  /** the bar's first words; defaults to "N overdue deals" */
  summary?: string;
  /** the small print under it; defaults to the Pipeline filter's note */
  note?: string;
}) {
  const { logActivity } = useCrm();
  const { addToast } = useToast();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [reason, setReason] = useState('');
  const [revisitDate, setRevisitDate] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deals.length === 0) return null;
  const count = deals.length;
  const noun = count === 1 ? 'deal' : 'deals';

  const apply = async (items: BulkItem[], done: (ok: number) => string) => {
    setRunning(true);
    setError(null);
    let ok = 0;
    let skipped = 0;
    // One at a time: each write is version-checked, so a deal changed meanwhile is skipped.
    for (const item of items) {
      try {
        await crm.updateDealIfUnchanged(item.deal.id, item.deal.updated_at, item.updates);
        logActivity({ type: 'edit', entity: 'deal', entityId: item.deal.id, label: item.label, description: item.description, undoPayload: item.before });
        ok += 1;
      } catch {
        skipped += 1;
      }
    }
    await onDone();
    setRunning(false);
    setMode({ kind: 'idle' });
    setReason('');
    setRevisitDate('');
    addToast(`${done(ok)}${skipped > 0 ? ` · ${skipped} skipped (changed in the meantime)` : ''}`, skipped > 0 && ok === 0 ? 'error' : undefined);
  };

  const confirmSnooze = (days: number) => {
    const { date, items } = planBulkSnooze(deals, today, days);
    void apply(items, ok => `Snoozed ${ok} ${ok === 1 ? 'deal' : 'deals'} to ${formatScheduleDate(date)}`);
  };

  const confirmPark = () => {
    const { items, error: planError } = planBulkPark(deals, { reason, revisitDate });
    if (planError) { setError(planError); return; }
    void apply(items, ok => `Parked ${ok} ${ok === 1 ? 'deal' : 'deals'}`);
  };

  const button = 'inline-flex h-8 items-center rounded-lg border border-clay-hairline px-3 text-xs font-medium text-clay-ink transition-colors hover:border-clay-ink/30 disabled:opacity-50';
  const primary = 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-clay-ink px-3 text-xs font-medium text-clay-canvas hover:opacity-90 disabled:opacity-50';

  return (
    <section aria-label="Bulk actions for overdue deals" data-testid="overdue-bulk-bar"
      className="mb-3 rounded-xl border border-clay-hairline bg-white px-3.5 py-2.5 text-sm dark:bg-clay-card">
      {mode.kind === 'idle' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-clay-body">{summary ?? `${count} overdue ${noun}`}</span>
          <span className="text-xs text-clay-muted">· Snooze all to</span>
          {SNOOZE_OPTIONS.map(option => (
            <button key={option.days} type="button" className={button} onClick={() => { setError(null); setMode({ kind: 'snooze', days: option.days }); }}>
              {option.label}
            </button>
          ))}
          <button type="button" className={button} onClick={() => { setError(null); setMode({ kind: 'park' }); }}>Park all…</button>
        </div>
      )}

      {mode.kind === 'snooze' && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm snooze">
          <span className="text-clay-ink">
            Move the follow-up of {count} {noun} to <strong>{formatScheduleDate(planBulkSnooze(deals, today, mode.days).date)}</strong>?
          </span>
          <button type="button" className={primary} disabled={running} onClick={() => confirmSnooze(mode.days)}>
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Snooze {count} {noun}
          </button>
          <button type="button" className={button} disabled={running} onClick={() => setMode({ kind: 'idle' })}>Cancel</button>
        </div>
      )}

      {mode.kind === 'park' && (
        <div className="space-y-2" role="group" aria-label="Confirm park">
          <p className="text-clay-ink">Park {count} {noun}? They leave the board until you revisit them.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              aria-label="Reason for parking"
              placeholder="Reason (required), e.g. no reply after 4 nudges"
              className="h-8 min-w-[14rem] flex-1 rounded-lg border border-clay-hairline bg-transparent px-2.5 text-xs text-clay-ink focus:outline-none focus:ring-2 focus:ring-clay-ink/10"
            />
            <label className="flex items-center gap-1.5 text-xs text-clay-muted">
              Revisit
              <input type="date" value={revisitDate} min={today} onChange={event => setRevisitDate(event.target.value)} aria-label="Revisit date (optional)"
                className="h-8 rounded-lg border border-clay-hairline bg-transparent px-2 text-xs text-clay-ink" />
            </label>
            <button type="button" className={primary} disabled={running} onClick={confirmPark}>
              {running && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Park {count} {noun}
            </button>
            <button type="button" className={button} disabled={running} onClick={() => setMode({ kind: 'idle' })}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-clay-error">{error}</p>}
      <p className="mt-1.5 text-[11px] text-clay-muted">{note ?? `Applies to all ${count} overdue ${noun} matching the filters, not only the cards in view — narrow with search or filters first. Each change can be undone from Recent changes.`}</p>
    </section>
  );
}
