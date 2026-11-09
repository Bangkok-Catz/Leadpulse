'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CalendarDays, ExternalLink, Hourglass, MessageCircle, Plus, Send, type LucideIcon } from 'lucide-react';
import { Blob } from '@/components/blob';
import { useCrm } from '@/components/CrmProvider';
import { useToast } from '@/components/ToastProvider';
import { PageTransition } from '@/components/motion';
import GrowthRow, { focusRing, smallBtn } from '@/components/GrowthRow';
import GrowthItemModal from '@/components/GrowthItemModal';
import GrowthLogModal from '@/components/GrowthLogModal';
import GrowthSocial from '@/components/GrowthSocial';
import TractionCard from '@/components/TractionCard';
import { CelebrateProvider, useCelebrate } from '@/components/game/Celebrate';
import { MilestoneSummary } from '@/components/game/Milestones';
import { useGrowthItems } from '@/hooks/useGrowthItems';
import * as growth from '@/lib/growth';
import * as sales from '@/lib/sales';
import { formatBangkokWeekdayDate } from '@/utils/format';
import { buildTodaysLeads } from '@/utils/prospecting';
import { splitRegulars, usualMonth, type CustomerRhythm } from '@/utils/sales-rhythm';
import { useBusinessDateKey } from '@/utils/useBusinessDateKey';
import {
  STAGE_LABELS,
  buildComingUp,
  clampStage,
  countTrack,
  groupGrowthItems,
  planStepDone,
  programsIn,
  type GrowthItem,
  type GrowthTrack,
} from '@/utils/growth';

type Tab = 'funding' | 'social';
type UpTab = 'due' | 'waiting' | 'later';

const UP_TABS: { id: UpTab; label: string; icon: LucideIcon; empty: string }[] = [
  { id: 'due', label: 'Due soon', icon: CalendarDays, empty: 'Nothing due in the next two weeks.' },
  { id: 'waiting', label: 'Waiting on them', icon: Send, empty: 'Nothing sent and waiting.' },
  { id: 'later', label: 'Later', icon: Hourglass, empty: 'No later steps.' },
];

/** First of the month, twelve months back: enough for the usual month. */
function salesSince(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 13, 1)).toISOString().slice(0, 10);
}

export default function GrowthPage() {
  return (
    <CelebrateProvider>
      <Growth />
    </CelebrateProvider>
  );
}

function Growth() {
  const today = useBusinessDateKey();
  const headerDate = formatBangkokWeekdayDate();
  const { companies, contacts, deals, meetings } = useCrm();
  const { addToast } = useToast();
  const { items, loading, error, reload } = useGrowthItems();

  const [tab, setTab] = useState<Tab>('funding');
  const [upTab, setUpTab] = useState<UpTab>('due');
  const [editing, setEditing] = useState<{ item: GrowthItem | null; track: GrowthTrack } | null>(null);
  const [logging, setLogging] = useState<{ itemId: string | null } | null>(null);

  // Traction: the usual month and regulars from Sales, leads from This week's count.
  const [salesFacts, setSalesFacts] = useState<{ usual: number | null; regulars: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([sales.getSalesByMonth(salesSince(today)), sales.getCustomerRhythms()]).then(
      ([months, rhythms]: [sales.MonthTotal[], CustomerRhythm[]]) => {
        if (cancelled) return;
        setSalesFacts({
          usual: usualMonth(months, `${today.slice(0, 7)}-01`),
          regulars: splitRegulars(rhythms, today).regulars.length,
        });
      },
      () => { if (!cancelled) setSalesFacts({ usual: null, regulars: 0 }); },
    );
    return () => { cancelled = true; };
  }, [today]);
  const leads = useMemo(
    () => buildTodaysLeads({ deals, companies, contacts, meetings, fits: new Map(), today }).fresh,
    [deals, companies, contacts, meetings, today],
  );
  const facts = { usualMonth: salesFacts?.usual ?? null, regulars: salesFacts?.regulars ?? 0, leads, programs: programsIn(items) };

  const comingUp = useMemo(() => buildComingUp(items, today), [items, today]);

  // Milestones: how many open funding rows stand at each of the five steps.
  const milestoneCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    for (const item of items) if (!item.deleted_at && item.status === 'open' && item.track === 'funding') counts[clampStage(item.stage) - 1]++;
    return counts;
  }, [items]);

  // A row that reaches a further milestone pops it and gets gold; "in program" gets confetti.
  const { fire } = useCelebrate();
  const stagesSeen = useRef<Map<string, number> | null>(null);
  const [pulses, setPulses] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (loading) return;
    const now = new Map(items.filter(i => i.status === 'open' && !i.deleted_at).map(i => [i.id, clampStage(i.stage)]));
    const before = stagesSeen.current;
    stagesSeen.current = now;
    if (!before) return;
    const moved = items.filter(i => now.has(i.id) && before.has(i.id) && now.get(i.id)! > before.get(i.id)!);
    if (moved.length === 0) return;
    setPulses(p => {
      const next = new Map(p);
      for (const i of moved) next.set(i.id, (next.get(i.id) ?? 0) + 1);
      return next;
    });
    for (const i of moved) {
      const row = document.querySelector(`[data-growth-id="${i.id}"]`);
      const top = clampStage(i.stage) === 5;
      fire(top ? 'confetti' : 'gold', row);
      addToast(`${i.name}: ${STAGE_LABELS[i.track][clampStage(i.stage) - 1]}`);
    }
  }, [items, loading, fire, addToast]);
  const groups = useMemo(() => (tab === 'social' ? [] : groupGrowthItems(items, tab)), [items, tab]);

  const openItem = (item: GrowthItem) => setEditing({ item, track: item.track });
  const addItem = () => setEditing({ item: null, track: 'funding' });
  const logItem = (itemId: string | null) => {
    if (!itemId && !items.some(i => i.status === 'open')) addItem();
    else setLogging({ itemId });
  };

  const archive = async (item: GrowthItem) => {
    try {
      await growth.archiveGrowthItem(item.id);
      reload();
      addToast(`Archived ${item.name}`, 'success', {
        label: 'Undo',
        onClick: () => { growth.restoreGrowthItem(item.id).then(reload, () => addToast('Could not undo', 'error')); },
      });
    } catch {
      addToast('Could not archive', 'error');
    }
  };

  const markDone = async (item: GrowthItem) => {
    const log = planStepDone(item, today);
    try {
      if (log.update) await growth.addGrowthUpdate(log.update);
      await growth.updateGrowthItem(item.id, log.patch);
      reload();
      addToast(log.update?.note ?? 'Done');
    } catch {
      addToast('Could not save', 'error');
    }
  };

  const siteLink = (item: GrowthItem) => item.url && (
    <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.name} site`} className={clsx(smallBtn, 'w-8 justify-center px-0')}>
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
  const logButton = (item: GrowthItem) => (
    <button type="button" onClick={() => logItem(item.id)} aria-label={`Log update for ${item.name}`} className={smallBtn}>Log</button>
  );

  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: 'funding', label: 'Funding', count: countTrack(items, 'funding') },
    { id: 'social', label: 'Social', count: null },
  ];
  const upRows = comingUp[upTab];

  return (
    <PageTransition className="p-4 md:p-6 max-w-6xl pb-20 lg:pb-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 md:mb-6">
        <div className="flex min-w-0 items-start gap-3">
          <Blob state="idle" size={48} follow aria-label="Butter mascot" />
          <div className="min-w-0">
            <p className="zams-eyebrow mb-1">{headerDate} · Bangkok</p>
            <h1 className="zams-display text-3xl leading-none md:text-[34px]">Growth</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={addItem}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-clay-hairline px-3 text-sm font-medium text-clay-ink transition-colors hover:border-clay-lavender hover:text-clay-lavender sm:px-4"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </button>
          <button type="button" onClick={() => logItem(null)} className="clay-btn-primary motion-press min-h-11">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            <span>Log update</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-clay-error/40 bg-clay-error/5 px-3 py-3 text-sm text-clay-ink">
          <p title={error}>Funding didn’t load.</p>
          <button type="button" onClick={reload} className={clsx('mt-2 min-h-11 rounded-md border border-clay-hairline px-3 py-2 text-xs font-semibold hover:border-clay-lavender', focusRing)}>
            Retry loading
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby="growth-coming-up" className="min-w-0 rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="growth-coming-up" className="text-sm font-semibold text-clay-ink">
              Coming up <span className="font-normal text-clay-muted">· {comingUp.total}</span>
            </h2>
            <span className="text-xs text-clay-muted">Soonest first</span>
          </div>
          <div role="tablist" aria-label="Coming up" className="no-scrollbar -mx-1 mb-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
            {UP_TABS.map(t => {
              const count = comingUp[t.id].length;
              const lateCount = t.id === 'due' ? comingUp.due.filter(i => i.next_date && i.next_date < today).length : 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={upTab === t.id}
                  onClick={() => setUpTab(t.id)}
                  className={clsx(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
                    upTab === t.id ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
                    focusRing,
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.label}
                  <span className={clsx('text-xs', lateCount > 0 ? 'font-semibold text-clay-error' : t.id === 'due' && count > 0 ? 'font-semibold text-clay-ochre-strong dark:text-clay-ochre' : 'text-clay-muted')}>{count}</span>
                </button>
              );
            })}
          </div>
          <div role="tabpanel" aria-label={UP_TABS.find(t => t.id === upTab)?.label}>
            {loading ? (
              <p role="status" className="px-1 py-4 text-sm text-clay-muted">Loading…</p>
            ) : upRows.length === 0 ? (
              <p className="px-1 py-4 text-sm text-clay-muted">{UP_TABS.find(t => t.id === upTab)?.empty}</p>
            ) : (
              <ul>
                {upRows.map((item, i) => (
                  <GrowthRow
                    key={item.id}
                    item={item}
                    today={today}
                    index={i}
                    showStage={false}
                    onOpen={openItem}
                    actions={<>
                      {siteLink(item)}
                      {upTab === 'due' && item.next_step && (
                        <button type="button" onClick={() => markDone(item)} aria-label={`Mark done: ${item.next_step}`} className={smallBtn}>Mark done</button>
                      )}
                      {logButton(item)}
                    </>}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        <TractionCard facts={facts} loading={salesFacts === null} />
      </div>

      <div role="tablist" aria-label="Growth" className="no-scrollbar -mx-1 mb-3 mt-6 flex gap-2 overflow-x-auto px-1">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3.5 text-sm transition-colors',
              tab === t.id ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
              focusRing,
            )}
          >
            {t.label}
            {t.count !== null && <span className="text-xs text-clay-muted">{t.count}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={tabs.find(t => t.id === tab)?.label}>
        {tab === 'social' ? (
          <GrowthSocial companies={companies} deals={deals} today={today} />
        ) : (
          <>
          {!loading && milestoneCounts.some(Boolean) && <MilestoneSummary labels={STAGE_LABELS.funding} counts={milestoneCounts} title="Funding milestones" />}
          <section className="min-w-0 rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
            {loading ? (
              <p role="status" className="px-1 py-2 text-sm text-clay-muted">Loading…</p>
            ) : groups.length === 0 ? (
              <div className="px-1 py-2 text-sm text-clay-muted">
                <p>Nothing on Funding yet.</p>
                <button type="button" onClick={addItem} className={clsx('mt-1 inline-flex min-h-11 items-center font-medium text-clay-lavender underline underline-offset-2', focusRing)}>
                  Add the first one
                </button>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.id}>
                  <h3 className="mb-1 mt-3 px-1 text-[11px] font-medium uppercase tracking-wide text-clay-muted first:mt-0">
                    {group.label} <span className="font-normal">· {group.items.length}</span>
                  </h3>
                  <ul>
                    {group.items.map((item, i) => (
                      <GrowthRow
                        key={item.id}
                        item={item}
                        today={today}
                        index={i}
                        onOpen={openItem}
                        pulse={pulses.get(item.id) ?? 0}
                        actions={item.status === 'open' ? <>{siteLink(item)}{logButton(item)}</> : siteLink(item) || null}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
          </>
        )}
      </div>

      <GrowthItemModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        item={editing?.item ?? null}
        track={editing?.track ?? 'funding'}
        onSaved={reload}
        onArchive={archive}
      />
      <GrowthLogModal
        open={logging !== null}
        onClose={() => setLogging(null)}
        items={items}
        itemId={logging?.itemId ?? null}
        today={today}
        onSaved={reload}
      />
    </PageTransition>
  );
}
