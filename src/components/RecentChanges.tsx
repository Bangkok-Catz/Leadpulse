'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { useCrm, type ActivityEntry } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import Fold from '@/components/Fold';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 15;

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Undoable system changes (archive, create, lane moves, won/lost/parked) from the last 7 days. */
/** `folded`: shown as a folded card (This week keeps it for reference). */
export default function RecentChanges({ folded = false }: { folded?: boolean } = {}) {
  // Fixed at mount; the 7-day window doesn't need to tick while the page is open.
  const [now] = useState(() => Date.now());
  const { activities = [], undoActivity } = useCrm();
  const { addToast } = useToast();
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const changes = activities
    .filter((a: ActivityEntry) => a.undoPayload && now - a.timestamp <= WINDOW_MS)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, LIMIT);
  if (changes.length === 0) return null;

  const undo = async (id: string) => {
    setUndoingId(id);
    const ok = await undoActivity(id);
    setUndoingId(null);
    if (!ok) addToast('Could not undo that change', 'error');
  };

  const list = (
      <ul>
        {changes.map((a) => {
          const undone = a.applied === false;
          return (
            <li key={a.id} className={clsx('flex items-center gap-2 border-t border-clay-hairline py-2 first:border-t-0', undone && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-clay-ink">{a.label}</p>
                <p className="truncate text-[11px] text-clay-muted">
                  {timeLabel(a.timestamp)}
                  {a.description ? ` · ${a.description}` : ''}
                </p>
              </div>
              {undone ? (
                <span className="shrink-0 text-xs text-clay-muted">Undone</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void undo(a.id)}
                  disabled={undoingId !== null}
                  aria-label={`Undo: ${a.label}`}
                  className="h-8 shrink-0 rounded-lg px-2 text-xs font-medium text-clay-lavender hover:bg-clay-surface active:scale-[0.97] disabled:opacity-50"
                >
                  {undoingId === a.id ? 'Undoing…' : 'Undo'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
  );
  if (folded) return <Fold label={<>Recent changes <span className="font-normal text-clay-muted">· {changes.length}</span></>}>{list}</Fold>;
  return (
    <section aria-labelledby="recent-changes" className="rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
      <h2 id="recent-changes" className="mb-1 text-sm font-semibold text-clay-ink">Recent changes</h2>
      {list}
    </section>
  );
}
