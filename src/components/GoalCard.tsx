'use client';

// ─── This week: the month's revenue goal ───
// Goal, won so far, the gap, and how many times the open pipeline covers the gap.
// The goal is one number per month, kept in sales_goals.

import { useEffect, useMemo, useState } from 'react';
import type { Deal } from '@/types/crm';
import * as crm from '@/lib/crm';
import { useCrm } from '@/components/CrmProvider';
import ActionButton from '@/components/ActionButton';
import { formatBaht } from '@/utils/format';
import { goalProgress, monthStart } from '@/utils/goal-progress';
import { laneTimelines } from '@/utils/lane-time';

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; goal: number | null };

/** `bare`: no card of its own, for use inside a fold that already names it. */
export default function GoalCard({ deals, today, bare = false }: { deals: Deal[]; today: string; bare?: boolean }) {
  const { activities = [] } = useCrm();
  const month = monthStart(today);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => crm.getSalesGoal(month))
      .then(goal => { if (!cancelled) setLoaded({ state: 'ready', goal }); })
      .catch(() => { if (!cancelled) setLoaded({ state: 'error' }); });
    return () => { cancelled = true; };
  }, [month]);

  const goal = loaded.state === 'ready' ? loaded.goal : null;
  const progress = useMemo(
    () => goalProgress({ deals, timelines: laneTimelines(deals, activities), today, goal }),
    [deals, activities, today, goal],
  );

  if (loaded.state !== 'ready') return null;

  const amount = Number(draft.replace(/,/g, ''));
  const valid = draft.trim() !== '' && Number.isFinite(amount) && amount >= 0;
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await crm.setSalesGoal(month, amount);
      setLoaded({ state: 'ready', goal: amount });
      setEditing(false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const monthName = new Date(`${month}T00:00:00`).toLocaleDateString('en-GB', { month: 'long' });
  const percent = goal && goal > 0 ? Math.min(100, Math.round((progress.won / goal) * 100)) : 0;

  return (
    <section aria-labelledby="month-goal" className={bare ? undefined : 'rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card'} data-testid="goal-card">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 id="month-goal" className={bare ? 'sr-only' : 'text-sm font-semibold text-clay-ink'}>{monthName} goal</h2>
        {!editing && (
          <button type="button" onClick={() => { setDraft(goal === null ? '' : String(goal)); setEditing(true); }}
            className="text-xs text-clay-muted underline decoration-clay-hairline underline-offset-2 hover:text-clay-ink">
            {goal === null ? 'Set a goal' : 'Change'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            inputMode="numeric"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            aria-label={`Revenue goal for ${monthName} in baht`}
            placeholder="e.g. 150000"
            className="h-8 w-36 rounded-lg border border-clay-hairline bg-transparent px-2.5 text-sm text-clay-ink focus:outline-none focus:ring-2 focus:ring-clay-ink/10"
          />
          <ActionButton busy={saving} disabled={!valid} onClick={save}>Save</ActionButton>
          <button type="button" disabled={saving} onClick={() => setEditing(false)}
            className="inline-flex h-8 items-center rounded-lg border border-clay-hairline px-3 text-xs font-medium text-clay-ink">
            Cancel
          </button>
          {saveError && <span role="alert" className="text-xs text-clay-error">Could not save the goal.</span>}
        </div>
      ) : goal === null ? (
        <p className="text-xs text-clay-muted">
          Won this month: <span className="font-semibold text-clay-ink">{formatBaht(progress.won)}</span> from {progress.wonDeals} {progress.wonDeals === 1 ? 'deal' : 'deals'}. No goal set.
        </p>
      ) : (
        <>
          <p className="text-sm text-clay-body">
            <span className="font-semibold text-clay-ink">{formatBaht(progress.won)}</span> won of {formatBaht(goal)}
          </p>
          <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-clay-surface" role="img" aria-label={`${percent}% of the goal`}>
            <div className="h-full rounded-full bg-clay-teal" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-clay-muted">
            {progress.gap === 0
              ? 'Goal met.'
              : <>Gap {formatBaht(progress.gap ?? 0)} · open pipeline {formatBaht(progress.openPipeline)}{progress.coverage !== null ? ` covers it ${progress.coverage}×` : ''}</>}
          </p>
        </>
      )}
      {progress.undatedWon > 0 && (
        <p className="mt-1 text-[11px] text-clay-muted">
          {progress.undatedWon} won {progress.undatedWon === 1 ? 'deal has' : 'deals have'} no closing date and {progress.undatedWon === 1 ? 'is' : 'are'} not counted in any month.
        </p>
      )}
    </section>
  );
}
