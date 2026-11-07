'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { AlarmClock, CalendarDays, CalendarOff, CircleAlert, HeartHandshake, Mail, MessageCircle, MessagesSquare, Phone, Users, type LucideIcon } from 'lucide-react';
import type { Company, Deal, DealWorkflowAction, Meeting } from '@/types/crm';
import CompanyLogo from '@/components/CompanyLogo';
import LaneIcon from '@/components/LaneIcon';
import RecentChanges from '@/components/RecentChanges';
import Fold from '@/components/Fold';
import GoalCard from '@/components/GoalCard';
import { useCrm } from '@/components/CrmProvider';
import { useLayaGrades } from '@/hooks/useLayaReviewList';
import type { HealthTier } from '@/utils/accountHealth';
import { actionChannel, type ActionChannel } from '@/utils/action-channel';
import { businessDaysBetween } from '@/utils/business-time';
import { formatScheduleDate } from '@/utils/deal-schedule';
import { WORKFLOW_BY_ID, getWorkflowAction } from '@/utils/deal-workflow';
import { buildDoNext, type DoNextItem, type DoNextKind } from '@/utils/do-next';
import type { AttentionCandidate } from '@/utils/followup-policy';
import { laneTimelines } from '@/utils/lane-time';
import type { CheckInRow, ThisWeekQueue as Queue } from '@/utils/this-week-queue';
import { checkInLine, checkInSplit, daysOverdue, dueByDay, dueWeekLine, groupOverdueByAge, overdueLine, touchesLastSevenDays, touchesLine } from '@/utils/this-week-stats';
import { CheckInRing, OverdueBars, TouchLine, WeekColumns } from '@/components/WeekCharts';

interface ThisWeekQueueProps {
  queue: Queue;
  today: string;
  deals: Deal[];
  companies: Company[];
  meetings: Meeting[];
  loading: boolean;
  sourceError: boolean;
  accountEventsUnavailable: boolean;
  onRetry: () => void;
  onLogDeal: (dealId: string) => void;
  onLogCompany: (companyId: string) => void;
  /** Today's leads, shown at the top of the "do now" card */
  leads?: ReactNode;
  /** the first of today's leads, suggested when there were no touches this week */
  firstLead?: string | null;
}

type Tab = 'overdue' | 'week' | 'undated';

const CHECK_IN_PREVIEW = 6;

/** Reasons that mean someone is waiting on Pat. Stalled and missing-data reasons live on Pipeline. */
const WAITING_KINDS: readonly DoNextKind[] = ['asked', 'review', 'waiting'];

const TIER: Record<HealthTier | 'reorder_only', { label: string; dot: string; chip: string }> = {
  at_risk: { label: 'At risk', dot: 'bg-clay-coral', chip: 'bg-clay-coral/15 text-clay-ink' },
  dormant: { label: 'Dormant', dot: 'bg-clay-muted-soft', chip: 'bg-clay-surface text-clay-muted' },
  watch: { label: 'Watch', dot: 'bg-clay-ochre', chip: 'bg-clay-ochre/15 text-clay-ink' },
  healthy: { label: 'Healthy', dot: 'bg-clay-mint', chip: 'bg-clay-mint/20 text-clay-ink' },
  reorder_only: { label: 'Reorder due', dot: 'bg-clay-lavender', chip: 'bg-clay-lavender/20 text-clay-ink' },
};

const CHANNEL_ICON: Record<ActionChannel, LucideIcon> = { call: Phone, email: Mail, message: MessageCircle, meeting: Users };

const TAB_ICON: Record<Tab, LucideIcon> = { overdue: AlarmClock, week: CalendarDays, undated: CalendarOff };

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-lavender';

/** Staggered rise-in; capped so long lists never wait on animation. */
const rise = (index: number): CSSProperties => ({ animationDelay: `${Math.min(index, 10) * 40}ms` });

function shortDate(dateKey: string): string {
  return formatScheduleDate(dateKey).replace(/ \d{4}$/, '');
}

function dayLabel(dateKey: string, offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const [y, m, d] = dateKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} ${shortDate(dateKey)}`;
}

/* ── Stat cards ─────────────────────────────────────────────────────────── */

function StatCard({
  icon: Icon,
  iconClass,
  label,
  value,
  valueClass,
  caption,
  chart,
  onClick,
  active,
  index,
}: {
  icon: LucideIcon;
  iconClass?: string;
  label: string;
  value: number;
  valueClass?: string;
  caption: string;
  /** a small 2D chart that animates in (components/WeekCharts.tsx) */
  chart: ReactNode;
  onClick: () => void;
  active?: boolean;
  index: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={rise(index)}
      className={clsx(
        'lp-rise flex min-w-0 flex-col rounded-xl border bg-white p-3 text-left transition-[transform,border-color] duration-150 ease-out active:scale-[0.97] dark:bg-clay-card sm:p-3.5',
        active ? 'border-clay-lavender/70' : 'border-clay-hairline hover:border-clay-ink/20',
        focusRing,
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-clay-muted">
        <Icon className={clsx('h-3.5 w-3.5 shrink-0', iconClass)} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className={clsx('mt-0.5 block text-2xl font-semibold leading-tight', valueClass ?? 'text-clay-ink')}>{value}</span>
      <span className="mt-0.5 block min-h-[2.8em] text-xs leading-snug text-clay-muted">{caption}</span>
      <span className="mt-2 block h-[64px]" aria-hidden="true">{chart}</span>
    </button>
  );
}

/* ── Rows ───────────────────────────────────────────────────────────────── */

const logBtn = clsx(
  'h-8 shrink-0 rounded-lg border border-clay-hairline px-2.5 text-xs font-medium text-clay-ink transition-transform duration-150 ease-out active:scale-[0.97] hover:border-clay-lavender',
  focusRing,
);

/** Every list on This week uses this row, like Today's leads: the name and chips on top,
 *  the next step underneath, the day count and Log on the right. Names wrap the chips
 *  instead of being cut short. */
function Row({ index, logo, name, chips, detail, below, aside, testId }: {
  index: number;
  logo: ReactNode;
  name: ReactNode;
  chips?: ReactNode;
  detail?: ReactNode;
  below?: ReactNode;
  aside?: ReactNode;
  testId?: string;
}) {
  return (
    <li
      style={rise(index)}
      data-testid={testId}
      className="lp-rise grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-x-2.5 border-t border-clay-hairline px-1 py-2.5 first:border-t-0"
    >
      <span className="self-start">{logo}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">{name}{chips}</div>
        {detail && <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-clay-muted">{detail}</p>}
        {below}
      </div>
      <div className="flex items-center justify-end gap-2">{aside}</div>
    </li>
  );
}

const nameClass = 'max-w-full truncate text-sm font-semibold text-clay-ink hover:text-clay-lavender rounded-sm';

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[11px]', className ?? 'bg-clay-surface text-clay-muted')}>{children}</span>;
}

function LaneChip({ lane, label }: { lane: DealWorkflowAction; label: string }) {
  return (
    <Chip>
      <LaneIcon lane={lane} className="h-3 w-3" />
      {label}
    </Chip>
  );
}

function Days({ text, late }: { text: string; late: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums', late ? 'font-semibold text-clay-error' : 'text-clay-muted')}>
      {late && <span className="h-1.5 w-1.5 rounded-full bg-clay-error" aria-hidden="true" />}
      {text}
    </span>
  );
}

function FollowupRow({
  item,
  deal,
  company,
  today,
  tone,
  onLogDeal,
  index,
}: {
  item: AttentionCandidate;
  deal?: Deal;
  company?: Company;
  today: string;
  tone: 'overdue' | 'upcoming' | 'undated' | 'review';
  onLogDeal: (dealId: string) => void;
  index: number;
}) {
  const title = item.dealTitle || item.companyName || 'Deal';
  const name = item.companyName || item.dealTitle || 'Deal';
  const lane = deal ? getWorkflowAction(deal) : null;
  const stage = lane ? WORKFLOW_BY_ID[lane]?.shortLabel : null;
  const canLog = Boolean(item.dealId) && item.action === 'honor_saved_followup' && item.holds.length === 0;
  const detail = tone === 'review' ? item.reason : item.nextAction;
  const channel = tone === 'review' ? null : actionChannel(item.nextAction);
  const ChannelIcon = channel ? CHANNEL_ICON[channel] : null;
  const days = daysOverdue(item.dueDate, today);
  const when =
    tone === 'overdue' ? `${days}d`
      : tone === 'upcoming' && item.dueDate ? (businessDaysBetween(today, item.dueDate) === 0 ? 'Today' : shortDate(item.dueDate))
        : null;

  return (
    <Row
      index={index}
      logo={<CompanyLogo src={company?.logo_url} name={name} id={item.companyId ?? undefined} size={30} />}
      name={item.dealId ? (
        <Link href={`/deals?deal=${encodeURIComponent(item.dealId)}`} aria-label={`Open deal: ${title}`} className={clsx(nameClass, focusRing)}>
          {name}
        </Link>
      ) : (
        <span className="max-w-full truncate text-sm font-semibold text-clay-ink">{name}</span>
      )}
      chips={<>
        {item.priority === 'high' && <Chip className="bg-clay-coral/15 font-semibold text-clay-coral">High</Chip>}
        {lane && stage && <LaneChip lane={lane} label={stage} />}
      </>}
      detail={detail ? <>
        {ChannelIcon && <ChannelIcon data-channel={channel} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate" title={detail}>{detail}</span>
      </> : null}
      below={item.holds.length > 0 && (
        <span className="mt-1 inline-flex rounded-md border border-clay-error/40 bg-clay-error/5 px-1.5 py-0.5 text-[11px] font-semibold text-clay-error">
          On hold — check before contacting
        </span>
      )}
      aside={<>
        {when && <Days text={when} late={tone === 'overdue'} />}
        {canLog && (
          <button type="button" onClick={() => onLogDeal(item.dealId!)} aria-label={`Log interaction for ${title}`} className={logBtn}>
            Log
          </button>
        )}
      </>}
    />
  );
}

/** A deal where the buyer (or Laya) is waiting on Pat: name, the reason, stage, Log. */
function WaitingRow({
  item,
  company,
  held,
  onLogDeal,
  index,
}: {
  item: DoNextItem;
  company?: Company;
  held: boolean;
  onLogDeal: (dealId: string) => void;
  index: number;
}) {
  const { deal } = item;
  const name = company?.name || deal.client || deal.title || 'Deal';
  const lane = getWorkflowAction(deal);
  const stage = WORKFLOW_BY_ID[lane]?.shortLabel;
  const reason = item.reasons[0].label;
  return (
    <Row
      index={index}
      logo={<CompanyLogo src={company?.logo_url} name={name} id={deal.company_id ?? undefined} size={30} />}
      name={
        <Link href={`/deals?deal=${encodeURIComponent(deal.id)}`} aria-label={`Open deal: ${deal.title || name}`} className={clsx(nameClass, focusRing)}>
          {name}
        </Link>
      }
      chips={stage && <LaneChip lane={lane} label={stage} />}
      detail={<span className="truncate text-clay-body" title={reason}>{reason}</span>}
      aside={held ? (
        <span className="text-[11px] font-semibold text-clay-error">On hold</span>
      ) : (
        <button type="button" onClick={() => onLogDeal(deal.id)} aria-label={`Log interaction for ${deal.title || name}`} className={logBtn}>
          Log
        </button>
      )}
    />
  );
}

function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <h3 className="mt-3 mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-clay-muted first:mt-0">
      {label} <span className="font-normal">· {count}</span>
    </h3>
  );
}

/* ── Side column ────────────────────────────────────────────────────────── */

function CheckInsCard({ rows, today, companies, onLogCompany }: {
  rows: CheckInRow[];
  today: string;
  companies: Map<string, Company>;
  onLogCompany: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, CHECK_IN_PREVIEW);
  return (
    <section id="check-ins" aria-labelledby="this-week-check-ins" className="min-w-0 rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
      <h2 id="this-week-check-ins" className="mb-1 text-sm font-semibold text-clay-ink">Customers to check in with</h2>
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-clay-muted">No customer check-ins due.</p>
      ) : (
        <ul>
          {visible.map((row, i) => {
            const tier = TIER[row.tier ?? 'reorder_only'];
            const late = row.dueDate ? daysOverdue(row.dueDate, today) : 0;
            const detail = [row.reorder && !row.dueDate ? `${row.reorder.severityDays}d past reorder` : null, row.reorder?.evidence]
              .filter(Boolean).join(' · ');
            return (
              <Row
                key={row.companyId}
                index={i}
                logo={<CompanyLogo src={companies.get(row.companyId)?.logo_url} name={row.companyName} id={row.companyId} size={30} />}
                name={
                  <Link
                    href={`/companies?company=${encodeURIComponent(row.companyId)}`}
                    aria-label={`Open company: ${row.companyName}`}
                    className={clsx(nameClass, focusRing)}
                  >
                    {row.companyName}
                  </Link>
                }
                chips={<Chip className={tier.chip}><span className={clsx('h-1.5 w-1.5 rounded-full', tier.dot)} aria-hidden="true" />{tier.label}</Chip>}
                detail={detail ? <span className="truncate" title={detail}>{detail}</span> : null}
                aside={<>
                  {late > 0 ? <Days text={`${late}d`} late /> : row.dueDate ? <Days text="Today" late={false} /> : null}
                  <button type="button" onClick={() => onLogCompany(row.companyId)} aria-label={`Log interaction for ${row.companyName}`} className={logBtn}>
                    Log
                  </button>
                </>}
              />
            );
          })}
        </ul>
      )}
      {rows.length > CHECK_IN_PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className={clsx('mt-1 h-8 text-xs font-medium text-clay-lavender rounded-sm', focusRing)}
        >
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

/* ── Page body ──────────────────────────────────────────────────────────── */

export default function ThisWeekQueue({
  queue,
  today,
  deals,
  companies,
  meetings,
  loading,
  sourceError,
  accountEventsUnavailable,
  onRetry,
  onLogDeal,
  onLogCompany,
  leads,
  firstLead,
}: ThisWeekQueueProps) {
  const { needsReview, overdue, dueThisWeek, checkIns, needsDate } = queue;
  // Until the user picks a tab, open on Overdue when there is any (data may still be arriving).
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const tab: Tab = chosenTab ?? (overdue.length > 0 ? 'overdue' : 'week');

  const dealsById = useMemo(() => new Map(deals.map(d => [d.id, d])), [deals]);
  const companiesById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies]);
  const ageGroups = useMemo(() => groupOverdueByAge(overdue, today), [overdue, today]);
  const days = useMemo(() => dueByDay(dueThisWeek, today), [dueThisWeek, today]);
  const split = useMemo(() => checkInSplit(checkIns), [checkIns]);
  const touches = useMemo(() => touchesLastSevenDays(meetings, today), [meetings, today]);

  // Deals where the buyer spoke last, or Laya needs a call. Shown once, above the dated lists.
  const { activities = [] } = useCrm();
  const { grades } = useLayaGrades(deals, meetings);
  const [now] = useState(() => Date.now());
  const waitingOnYou = useMemo(
    () => buildDoNext({ deals, meetings, grades, timelines: laneTimelines(deals, activities), today, now })
      .filter(item => WAITING_KINDS.includes(item.reasons[0].kind)),
    [deals, meetings, grades, activities, today, now],
  );
  const heldDealIds = useMemo(
    () => new Set([...needsReview, ...overdue, ...dueThisWeek, ...needsDate].filter(c => c.holds.length > 0 && c.dealId).map(c => c.dealId!)),
    [needsReview, overdue, dueThisWeek, needsDate],
  );

  const row = (item: AttentionCandidate, tone: Parameters<typeof FollowupRow>[0]['tone'], index: number) => (
    <FollowupRow
      key={item.id}
      item={item}
      deal={item.dealId ? dealsById.get(item.dealId) : undefined}
      company={item.companyId ? companiesById.get(item.companyId) : undefined}
      today={today}
      tone={tone}
      onLogDeal={onLogDeal}
      index={index}
    />
  );

  const isEmpty = needsReview.length + overdue.length + dueThisWeek.length + checkIns.length + needsDate.length === 0;
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'overdue', label: 'Overdue', count: overdue.length },
    { id: 'week', label: 'This week', count: dueThisWeek.length },
    { id: 'undated', label: 'No date', count: needsDate.length },
  ];

  const openTab = (next: Tab) => {
    setTab(next);
    document.getElementById('follow-ups')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-xl border border-clay-hairline bg-white p-5 text-sm text-clay-muted dark:bg-clay-card">
        Loading this week…
      </div>
    );
  }

  const monthName = new Date(`${today.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long' });
  const dayLetters = days.map(d => {
    const [y, m, dd] = d.date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' });
  });
  const block = 'mt-3 border-t border-clay-hairline pt-3 first-of-type:mt-0 first-of-type:border-t-0 first-of-type:pt-0';

  return (
    <div data-testid="this-week-queue" className="mb-6 min-w-0 space-y-4">
      {sourceError && (
        <div role="alert" className="rounded-lg border border-clay-error/40 bg-clay-error/5 px-3 py-3 text-sm text-clay-ink">
          <p>CRM data could not be loaded. This list may be incomplete.</p>
          <button
            type="button"
            onClick={onRetry}
            className={clsx('mt-2 min-h-11 rounded-md border border-clay-hairline px-3 py-2 text-xs font-semibold hover:border-clay-lavender', focusRing)}
          >
            Retry loading
          </button>
        </div>
      )}

      {accountEventsUnavailable && (
        <p role="status" className="rounded-lg border border-clay-ochre/40 bg-clay-ochre/5 px-3 py-2 text-xs text-clay-ink">
          Sales history didn’t load, so customer check-ins may be incomplete.
        </p>
      )}

      {/* 1 · Do now: today's leads, decisions, who's waiting on you, then the dated follow-ups. */}
      <section id="follow-ups" aria-labelledby="this-week-follow-ups" className="min-w-0 scroll-mt-4 rounded-xl border border-clay-hairline bg-white p-3.5 dark:bg-clay-card">
        <h2 id="this-week-follow-ups" className="sr-only">Follow-ups</h2>

        {leads && <div className={block}>{leads}</div>}

        {/* A failed load with nothing to show stays a failure, never an all-clear. */}
        {isEmpty && sourceError ? null : isEmpty ? (
          <div className={clsx(block, 'text-sm text-clay-muted')}>
            <p>Nothing due this week.</p>
            <Link href="/deals" className={clsx('mt-1 inline-flex min-h-11 items-center font-medium text-clay-lavender underline underline-offset-2', focusRing)}>
              Open the pipeline
            </Link>
          </div>
        ) : (
          <>
            {needsReview.length > 0 && (
              <div className="mt-3 rounded-lg border border-clay-error/30 bg-clay-error/5 p-2.5 first-of-type:mt-0">
                <h3 className="px-1 text-xs font-semibold text-clay-error">Needs a decision · {needsReview.length}</h3>
                <ul>{needsReview.map((item, i) => row(item, 'review', i))}</ul>
              </div>
            )}

            {waitingOnYou.length > 0 && (
              <div className={block} data-testid="waiting-on-you">
                <h3 className="px-1 text-sm font-semibold text-clay-ink">Waiting on you <span className="font-normal text-clay-muted">· {waitingOnYou.length}</span></h3>
                <ul>
                  {waitingOnYou.map((item, i) => (
                    <WaitingRow
                      key={item.deal.id}
                      item={item}
                      company={item.deal.company_id ? companiesById.get(item.deal.company_id) : undefined}
                      held={heldDealIds.has(item.deal.id)}
                      onLogDeal={onLogDeal}
                      index={i}
                    />
                  ))}
                </ul>
              </div>
            )}

            <div className={block}>
              <div role="tablist" aria-label="Follow-ups" className="no-scrollbar -mx-1 mb-1 flex gap-1.5 overflow-x-auto px-1">
                {tabs.map(t => {
                  const TabIcon = TAB_ICON[t.id];
                  return (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      className={clsx(
                        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors',
                        tab === t.id ? 'border-clay-lavender/60 bg-clay-lavender/20 text-clay-ink' : 'border-clay-hairline text-clay-muted hover:text-clay-ink',
                        focusRing,
                      )}
                    >
                      <TabIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {t.label}
                      <span className={clsx('text-xs', t.id === 'overdue' && t.count > 0 ? 'font-semibold text-clay-error' : 'text-clay-muted')}>{t.count}</span>
                    </button>
                  );
                })}
              </div>

              <div role="tabpanel" aria-label={tabs.find(t => t.id === tab)?.label}>
                {tab === 'overdue' && (overdue.length === 0 ? (
                  <p className="px-1 py-4 text-sm text-clay-muted">Nothing overdue.</p>
                ) : (
                  ageGroups.map(group => (
                    <div key={group.id}>
                      <GroupHeader label={group.label} count={group.items.length} />
                      <ul>{group.items.map((item, i) => row(item, 'overdue', i))}</ul>
                    </div>
                  ))
                ))}

                {tab === 'week' && (dueThisWeek.length === 0 ? (
                  <p className="px-1 py-4 text-sm text-clay-muted">Nothing else due this week.</p>
                ) : (
                  days.filter(d => d.items.length > 0).map(d => (
                    <div key={d.date}>
                      <GroupHeader label={dayLabel(d.date, d.offset)} count={d.items.length} />
                      <ul>{d.items.map((item, i) => row(item, 'upcoming', i))}</ul>
                    </div>
                  ))
                ))}

                {tab === 'undated' && (needsDate.length === 0 ? (
                  <p className="px-1 py-4 text-sm text-clay-muted">Every open deal has a follow-up date.</p>
                ) : (
                  <>
                    <p className="mb-1 px-1 text-xs text-clay-muted">Open a deal to set a follow-up date or park it.</p>
                    <ul>{needsDate.map((item, i) => row(item, 'undated', i))}</ul>
                  </>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {!isEmpty && (
        <>
          {/* 2 · Keep an eye on: four numbers with small animated charts; tap one to open its list. */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="This week at a glance">
            <StatCard
              index={0}
              icon={CircleAlert}
              iconClass={overdue.length > 0 ? 'text-clay-error' : undefined}
              label="Overdue"
              value={overdue.length}
              valueClass={overdue.length > 0 ? 'text-clay-error' : undefined}
              active={tab === 'overdue'}
              onClick={() => openTab('overdue')}
              caption={overdueLine(overdue, today)}
              chart={<OverdueBars groups={(['over_two_weeks', 'last_week', 'this_week'] as const).map(id => ageGroups.find(g => g.id === id)?.items.length ?? 0) as [number, number, number]} />}
            />
            <StatCard
              index={1}
              icon={CalendarDays}
              label="Due this week"
              value={dueThisWeek.length}
              active={tab === 'week'}
              onClick={() => openTab('week')}
              caption={dueWeekLine(days)}
              chart={<WeekColumns counts={days.map(d => d.items.length)} letters={dayLetters} />}
            />
            <StatCard
              index={2}
              icon={HeartHandshake}
              label="Check-ins"
              value={checkIns.length}
              onClick={() => document.getElementById('check-ins')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
              caption={checkInLine(split)}
              chart={<CheckInRing split={split} />}
            />
            <StatCard
              index={3}
              icon={MessagesSquare}
              label="Touches · 7 days"
              value={touches.total}
              onClick={() => openTab('week')}
              caption={touches.total === 0 && firstLead ? `None yet. Start with ${firstLead}.` : touchesLine(touches, today)}
              chart={<TouchLine series={touches.series} />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] lg:items-start">
            <CheckInsCard rows={checkIns} today={today} companies={companiesById} onLogCompany={onLogCompany} />
            {/* 3 · Reference, folded until opened. */}
            <div className="min-w-0 space-y-3">
              <Fold label={`${monthName} goal`}><GoalCard deals={deals} today={today} bare /></Fold>
              <RecentChanges folded />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
