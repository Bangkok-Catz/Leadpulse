'use client';

// ─── Growth: funding as milestones ───
// A row's track: five milestones joined by a line, the ones reached filled in, the current
// one ringed, the last one gold once reached. The summary above the Funding list counts
// how many rows stand at each milestone, in the same five steps, the last one gold.

import clsx from 'clsx';

export function MilestoneTrack({ labels, reached, pulse = 0 }: {
  labels: readonly string[];
  /** 1..labels.length */
  reached: number;
  /** bumped when the row just moved forward, to replay the reached milestone's pop */
  pulse?: number;
}) {
  const last = labels.length;
  return (
    <span className="inline-flex items-center gap-2" data-testid="milestone-track" data-reached={reached}>
      <span className="inline-flex items-center" role="img" aria-label={`Milestone ${reached} of ${last}: ${labels[reached - 1]}`}>
        {labels.map((label, i) => {
          const n = i + 1;
          const done = n <= reached;
          const current = n === reached;
          const goal = n === last;
          return (
            <span key={label} className="inline-flex items-center" title={label}>
              {i > 0 && <span aria-hidden="true" className={clsx('h-0.5 w-3 sm:w-4', n <= reached ? (goal ? 'bg-clay-ochre' : 'bg-clay-lavender') : 'bg-clay-hairline')} />}
              <span
                key={current ? pulse : undefined}
                aria-hidden="true"
                className={clsx(
                  'block rounded-full',
                  current ? 'h-2.5 w-2.5 ring-2 ring-offset-1 ring-offset-white dark:ring-offset-clay-card' : 'h-2 w-2',
                  done ? (goal ? 'bg-clay-ochre' : 'bg-clay-lavender') : 'bg-clay-hairline',
                  current && (goal ? 'ring-clay-ochre/50' : 'ring-clay-lavender/50'),
                  current && pulse > 0 && 'lp-check-in',
                )}
              />
            </span>
          );
        })}
      </span>
      <span className={clsx('text-xs', reached === last ? 'font-semibold text-clay-ink' : 'text-clay-body')}>{labels[reached - 1]}</span>
    </span>
  );
}

export function MilestoneSummary({ labels, counts, title }: { labels: readonly string[]; counts: number[]; title: string }) {
  return (
    <section aria-label={title} className="mb-3 rounded-xl border border-clay-hairline bg-white px-3 py-3 dark:bg-clay-card" data-testid="milestone-summary">
      <ol className="grid grid-cols-5">
        {labels.map((label, i) => {
          const goal = i === labels.length - 1;
          return (
            <li key={label} className="flex min-w-0 flex-col items-center" aria-label={`${label}: ${counts[i]}`}>
              <span className="relative flex w-full justify-center">
                <span aria-hidden="true" className={clsx('absolute top-1/2 h-0.5 -translate-y-1/2 bg-clay-hairline dark:bg-clay-muted-soft/40', i === 0 ? 'left-1/2 right-0' : goal ? 'left-0 right-1/2' : 'inset-x-0')} />
                <span
                  className={clsx(
                    'zams-mono relative grid h-9 w-9 place-items-center rounded-full border-2 text-[12.5px] tabular-nums',
                    goal
                      ? counts[i] > 0 ? 'border-clay-ochre bg-clay-ochre/15 text-clay-ink' : 'border-clay-hairline bg-white text-clay-muted dark:bg-clay-card'
                      : counts[i] > 0 ? 'border-clay-lavender/70 bg-white text-clay-ink dark:bg-clay-card' : 'border-clay-hairline bg-white text-clay-muted dark:bg-clay-card',
                  )}
                >
                  <span key={counts[i]} className="lp-pop">{counts[i]}</span>
                </span>
              </span>
              <span className="mt-1.5 text-center text-[11px] font-medium leading-tight first-letter:uppercase text-clay-ink">{label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
