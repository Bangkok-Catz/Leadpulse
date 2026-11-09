'use client';

// ─── One-tap logging on This week ───
// A step's button says what Pat did ("Sample sent", "Called") and logs it in one tap, the
// way utils/quick-log.ts builds it. Afterwards a short note at the bottom says what changed,
// lets Pat move the next follow-up (+3 days, +1 week, none) and has Undo.

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Company, Deal, Meeting } from '@/types/crm';
import * as crm from '@/lib/crm';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import { formatScheduleDate } from '@/utils/deal-schedule';
import { addDaysToDateKey } from '@/utils/deal-workflow';
import {
  FOLLOWUP_OPTIONS, QUICK, QUICK_FOLLOWUP_DAYS, SAMPLE_CHECK_DAYS, buildQuickLog, followupPatch, type QuickKind,
} from '@/utils/quick-log';

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender';

export interface QuickTarget {
  /** the step's key, so its button can show it is saving */
  key: string;
  name: string;
  deal?: Deal | null;
  companyId?: string | null;
  /** runs once the touch is saved (a check-in moves the account's next date); returns what it replaced */
  after?: () => Promise<Partial<Company> | null>;
}

export interface LoggedEntry {
  /** changes on every log, so the note restarts its timer */
  id: string;
  name: string;
  kind: QuickKind;
  meetingId: string | null;
  dealId: string | null;
  /** the activity entry for the deal change, which Undo reverses */
  activityId: string | null;
  before: Partial<Deal>;
  /** the account fields the check-in replaced, put back on Undo */
  companyId: string | null;
  companyBefore: Partial<Company> | null;
  /** days to the follow-up now on the deal; null = no date; undefined = this log sets none */
  days?: number | null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'unknown error');

export function useQuickLog(today: string) {
  const { addMeeting, refresh, logActivity, undoActivity, deals } = useCrm();
  const { addToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<LoggedEntry | null>(null);
  const busyRef = useRef<string | null>(null);
  const dealsRef = useRef(deals);
  useEffect(() => { dealsRef.current = deals; }, [deals]);

  const log = useCallback(async (target: QuickTarget, kind: QuickKind, words?: string) => {
    if (busyRef.current) return;
    let built: ReturnType<typeof buildQuickLog>;
    try {
      built = buildQuickLog({ kind, today, deal: target.deal ?? null, companyId: target.companyId ?? null, words });
    } catch (err) {
      addToast(errorText(err), 'error');
      return;
    }
    busyRef.current = target.key;
    setBusy(target.key);
    let saved: Meeting | void;
    try {
      saved = await addMeeting(built.meeting);
    } catch (err) {
      addToast(`Could not log it: ${errorText(err)}`, 'error');
      busyRef.current = null;
      setBusy(null);
      return;
    }
    const companyBefore = target.after ? await target.after().catch(() => null) : null;
    let activityId: string | null = null;
    let patched = Object.keys(built.dealPatch).length === 0;
    if (target.deal && !patched) {
      try {
        await crm.updateDealIfUnchanged(target.deal.id, target.deal.updated_at, built.dealPatch);
        activityId = logActivity({
          type: 'edit', entity: 'deal', entityId: target.deal.id, label: QUICK[kind].label,
          description: `${target.name}: ${QUICK[kind].label}`, undoPayload: built.before,
        });
        patched = true;
        await refresh();
      } catch (err) {
        addToast(`Logged, but the deal's next date didn't update. Open the deal to set it. ${errorText(err)}`, 'error');
      }
    }
    busyRef.current = null;
    setBusy(null);
    setLast({
      id: `${target.key}:${Date.now()}`,
      name: target.name,
      kind,
      meetingId: saved && 'id' in saved ? saved.id : null,
      dealId: target.deal?.id ?? null,
      companyId: target.companyId ?? null,
      companyBefore,
      activityId,
      before: patched ? built.before : {},
      days: patched && built.followupDate ? (kind === 'sample' ? SAMPLE_CHECK_DAYS : QUICK_FOLLOWUP_DAYS) : undefined,
    });
  }, [today, addMeeting, refresh, logActivity, addToast]);

  const setFollowup = useCallback(async (days: number | null) => {
    const entry = last;
    if (!entry?.dealId || entry.days === undefined || entry.days === days) return;
    const deal = dealsRef.current.find(d => d.id === entry.dealId);
    const patch = followupPatch(today, days);
    try {
      if (deal) await crm.updateDealIfUnchanged(deal.id, deal.updated_at, patch);
      else await crm.updateDeal(entry.dealId, patch);
      await refresh();
      setLast({ ...entry, days });
    } catch (err) {
      addToast(`Could not change the date: ${errorText(err)}`, 'error');
    }
  }, [last, today, refresh, addToast]);

  const undo = useCallback(async () => {
    const entry = last;
    if (!entry) return;
    setLast(null);
    try {
      if (entry.meetingId) await crm.softDelete('meetings', entry.meetingId);
      if (entry.dealId && Object.keys(entry.before).length > 0) {
        const reversed = entry.activityId ? await undoActivity(entry.activityId) : false;
        if (!reversed) await crm.updateDeal(entry.dealId, entry.before);
      }
      if (entry.companyId && entry.companyBefore) await crm.updateCompany(entry.companyId, entry.companyBefore);
      await refresh();
      addToast('Undone');
    } catch (err) {
      addToast(`Could not undo: ${errorText(err)}`, 'error');
      await refresh();
    }
  }, [last, undoActivity, refresh, addToast]);

  const close = useCallback(() => setLast(null), []);

  return { log, busy, last, setFollowup, undo, close };
}

function shortDate(dateKey: string): string {
  return formatScheduleDate(dateKey).replace(/ \d{4}$/, '');
}

/** The note after a tap: what was logged, the next date with its options, and Undo. */
export function LoggedNote({ entry, today, onFollowup, onUndo, onClose }: {
  entry: LoggedEntry;
  today: string;
  onFollowup: (days: number | null) => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold) return;
    const timer = setTimeout(onClose, 8000);
    return () => clearTimeout(timer);
  }, [entry, hold, onClose]);

  const dated = entry.days !== undefined;
  const when = entry.days == null ? null : shortDate(addDaysToDateKey(today, entry.days));
  const what = entry.kind === 'reply'
    ? `Reply saved · ${entry.name} · your move`
    : entry.kind === 'sample'
      ? `Sample sent · ${entry.name}${when ? ` · check it arrived ${when}` : ''}`
      : `${QUICK[entry.kind].label} · ${entry.name}${dated ? (when ? ` · next follow-up ${when}` : ' · no follow-up date') : ''}`;

  return (
    <div
      role="status"
      data-testid="logged-note"
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)}
      onBlurCapture={() => setHold(false)}
      className="lp-drop-in fixed bottom-[calc(16px+env(safe-area-inset-bottom,0px))] left-1/2 z-[80] grid w-[min(560px,calc(100%-32px))] -translate-x-1/2 gap-2 rounded-2xl bg-clay-ink px-4 py-3 text-clay-canvas shadow-xl"
    >
      <p className="text-[13.5px] leading-snug">{what}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {dated && (
          <>
            <span className="mr-0.5 text-xs opacity-70">{entry.kind === 'sample' ? 'Check it arrived' : 'Next follow-up'}</span>
            {FOLLOWUP_OPTIONS.map(option => (
              <button
                key={option.label}
                type="button"
                aria-pressed={entry.days === option.days}
                onClick={() => onFollowup(option.days)}
                className={clsx(
                  'rounded-lg px-2.5 py-1 text-[12.5px] font-medium',
                  entry.days === option.days ? 'bg-clay-canvas text-clay-ink' : 'bg-clay-canvas/15 hover:bg-clay-canvas/25',
                  focusRing,
                )}
              >
                {option.label}
              </button>
            ))}
          </>
        )}
        <button type="button" onClick={onUndo} className={clsx('ml-auto rounded-lg px-2 py-1 text-[12.5px] font-medium underline underline-offset-2', focusRing)}>
          Undo
        </button>
      </div>
    </div>
  );
}
