// ─── Growth page: funding as a short pipeline, and where buyers came from ───
// Pure. Rows live in growth_items and growth_updates
// (supabase/migrations/20261108090000_growth_page.sql); loading and saving are in lib/growth.ts.

import type { Company, Deal } from '@/types/crm';
import { isAcquisitionSource, type AcquisitionSource } from './acquisition-source';
import { businessDaysBetween, isCalendarDateKey } from './business-time';
import { formatBaht } from './format';

export type GrowthTrack = 'funding' | 'pr';
export const GROWTH_TRACKS: readonly GrowthTrack[] = ['funding', 'pr'];

/** Same values as the growth_items kind check constraint. */
export const GROWTH_KINDS = [
  'government', 'investor', 'accelerator', 'tv_show', 'award', 'pitch_event',
  'press', 'event', 'moment', 'social',
] as const;
export type GrowthKind = (typeof GROWTH_KINDS)[number];

export const GROWTH_STATUSES = ['open', 'missed', 'declined', 'done'] as const;
export type GrowthStatus = (typeof GROWTH_STATUSES)[number];

export interface GrowthItem {
  id: string;
  track: GrowthTrack;
  name: string;
  kind: GrowthKind;
  /** what it gives: "Equity", "US$100k prize", "Grant" */
  offer: string | null;
  /** 1–5, see STAGE_LABELS */
  stage: number;
  status: GrowthStatus;
  next_step: string | null;
  next_date: string | null;
  /** set when something was sent and the next move is theirs */
  waiting_since: string | null;
  url: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface GrowthUpdate {
  id: string;
  item_id: string;
  happened_on: string;
  note: string;
  created_at: string;
}

export const GROWTH_KIND_LABELS: Record<GrowthKind, string> = {
  government: 'Government',
  investor: 'Investor',
  accelerator: 'Accelerator',
  tv_show: 'TV show',
  award: 'Award',
  pitch_event: 'Pitch event',
  press: 'Press',
  event: 'Event',
  moment: 'Moment',
  social: 'Social',
};

/** The kinds the Add form offers on each tab; the database accepts any kind on either. */
export const KINDS_BY_TRACK: Record<GrowthTrack, GrowthKind[]> = {
  funding: ['government', 'investor', 'accelerator', 'tv_show', 'award', 'pitch_event'],
  pr: ['press', 'event', 'moment', 'social', 'award', 'tv_show'],
};

export const TRACK_LABELS: Record<GrowthTrack, string> = { funding: 'Funding', pr: 'PR' };

export const STAGE_LABELS: Record<GrowthTrack, readonly [string, string, string, string, string]> = {
  funding: ['watching', 'applying', 'submitted', 'pitching', 'in program'],
  pr: ['idea', 'planned', 'pitched', 'booked', 'published'],
};

export const CLOSED_LABELS: Record<Exclude<GrowthStatus, 'open'>, string> = {
  missed: 'Missed',
  declined: 'Declined',
  done: 'Done',
};

export function isGrowthKind(value: unknown): value is GrowthKind {
  return typeof value === 'string' && (GROWTH_KINDS as readonly string[]).includes(value);
}

export function clampStage(stage: unknown): number {
  const n = Math.round(Number(stage));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 1;
}

/** "Stage 3 of 5 · submitted" */
export function stageLine(item: Pick<GrowthItem, 'track' | 'stage'>): string {
  const stage = clampStage(item.stage);
  return `Stage ${stage} of 5 · ${STAGE_LABELS[item.track][stage - 1]}`;
}

/** "Fri 14 Nov" */
export function shortDay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const isLive = (item: GrowthItem) => !item.deleted_at;
const isOpen = (item: GrowthItem) => isLive(item) && item.status === 'open';

/** Soonest date first, undated last, then by name. */
function byNextDate(a: GrowthItem, b: GrowthItem): number {
  if (a.next_date && b.next_date && a.next_date !== b.next_date) return a.next_date < b.next_date ? -1 : 1;
  if (Boolean(a.next_date) !== Boolean(b.next_date)) return a.next_date ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// ─── Tabs ───

export interface GrowthGroup {
  id: string;
  label: string;
  items: GrowthItem[];
}

/** Funding leads with what Pat is already in; PR with live work, published last. */
const GROUP_ORDER: Record<GrowthTrack, number[]> = { funding: [5, 4, 3, 2, 1], pr: [4, 3, 2, 1, 5] };
const GROUP_LABELS: Record<GrowthTrack, Record<number, string>> = {
  funding: { 5: 'In a program', 4: 'Pitching', 3: 'Submitted', 2: 'Applying', 1: 'Watching' },
  pr: { 5: 'Published', 4: 'Booked', 3: 'Pitched', 2: 'Planned', 1: 'Ideas' },
};

/** One tab's rows, grouped by stage; missed, declined and done rows close the list. Empty groups are left out. */
export function groupGrowthItems(items: readonly GrowthItem[], track: GrowthTrack): GrowthGroup[] {
  const mine = items.filter(item => isLive(item) && item.track === track);
  const groups: GrowthGroup[] = GROUP_ORDER[track].map(stage => ({
    id: `stage-${stage}`,
    label: GROUP_LABELS[track][stage],
    items: mine.filter(item => item.status === 'open' && clampStage(item.stage) === stage).sort(byNextDate),
  }));
  groups.push({
    id: 'closed',
    label: 'Closed',
    items: mine.filter(item => item.status !== 'open').sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  });
  return groups.filter(group => group.items.length > 0);
}

export function countTrack(items: readonly GrowthItem[], track: GrowthTrack): number {
  return items.filter(item => isLive(item) && item.track === track).length;
}

// ─── Coming up ───

/** A dated step this close (or late) is "due soon". */
export const DUE_SOON_DAYS = 14;

export interface ComingUp {
  /** dated within DUE_SOON_DAYS, or late */
  due: GrowthItem[];
  /** sent, the next move is theirs */
  waiting: GrowthItem[];
  /** a next step that is further out or undated */
  later: GrowthItem[];
  /** rows across the three tabs, each counted once */
  total: number;
}

export function buildComingUp(items: readonly GrowthItem[], today: string): ComingUp {
  const open = items.filter(isOpen);
  const soon = (item: GrowthItem) => isCalendarDateKey(item.next_date) && businessDaysBetween(today, item.next_date) <= DUE_SOON_DAYS;
  const due = open.filter(soon).sort(byNextDate);
  const waiting = open.filter(item => item.waiting_since).sort(byNextDate);
  const later = open
    .filter(item => !soon(item) && !item.waiting_since && (item.next_step?.trim() || item.next_date))
    .sort(byNextDate);
  const total = new Set([...due, ...waiting, ...later].map(item => item.id)).size;
  return { due, waiting, later, total };
}

export interface DueLabel {
  text: string;
  tone: 'late' | 'soon' | 'later';
}

/** "3d late", "today", "tomorrow", "in 5 days", or "Mon 5 Jan" further out. */
export function dueLabel(date: string | null, today: string): DueLabel | null {
  if (!isCalendarDateKey(date)) return null;
  const days = businessDaysBetween(today, date);
  if (days < 0) return { text: `${-days}d late`, tone: 'late' };
  if (days === 0) return { text: 'today', tone: 'soon' };
  if (days === 1) return { text: 'tomorrow', tone: 'soon' };
  if (days <= DUE_SOON_DAYS) return { text: `in ${days} days`, tone: 'soon' };
  return { text: shortDay(date), tone: 'later' };
}

/** The row's second line: "Sent Mon 3 Nov · Nudge about the deck · Mon 10 Nov". Empty when there is nothing to say. */
export function itemLine(item: GrowthItem): string {
  const step = item.next_step?.trim();
  const parts = [
    item.waiting_since ? `Sent ${shortDay(item.waiting_since)}` : null,
    step || null,
    isCalendarDateKey(item.next_date) ? shortDay(item.next_date) : null,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  return item.note?.trim().split('\n')[0] ?? '';
}

// ─── This week ───

export interface GrowthDue {
  overdue: GrowthItem[];
  /** today and the six days after */
  week: GrowthItem[];
}

/** Funding and PR steps This week lists next to the buyer follow-ups. */
export function growthDueThisWeek(items: readonly GrowthItem[], today: string): GrowthDue {
  const overdue: GrowthItem[] = [];
  const week: GrowthItem[] = [];
  for (const item of items.filter(isOpen)) {
    if (!isCalendarDateKey(item.next_date)) continue;
    const days = businessDaysBetween(today, item.next_date);
    if (days < 0) overdue.push(item);
    else if (days <= 6) week.push(item);
  }
  return { overdue: overdue.sort(byNextDate), week: week.sort(byNextDate) };
}

// ─── Logging ───

export interface GrowthLog {
  update: { item_id: string; happened_on: string; note: string } | null;
  patch: Partial<Pick<GrowthItem, 'stage' | 'next_step' | 'next_date' | 'waiting_since'>>;
}

/**
 * What a logged update writes: the note as a growth_updates row, and the item's new next
 * step, date, stage and "waiting on them". A blank note writes no update row.
 */
export function planGrowthLog(input: {
  item: Pick<GrowthItem, 'id' | 'stage' | 'waiting_since'>;
  note: string;
  nextStep: string;
  nextDate: string;
  stage: number;
  waiting: boolean;
  today: string;
}): GrowthLog {
  const note = input.note.trim();
  const nextStep = input.nextStep.trim();
  return {
    update: note ? { item_id: input.item.id, happened_on: input.today, note } : null,
    patch: {
      stage: clampStage(input.stage),
      next_step: nextStep || null,
      next_date: isCalendarDateKey(input.nextDate) ? input.nextDate : null,
      // Keep the first "sent" date while still waiting; a fresh wait starts today.
      waiting_since: input.waiting ? input.item.waiting_since ?? input.today : null,
    },
  };
}

/** "Mark done" on a due step: log it and clear the step so the row leaves Coming up. */
export function planStepDone(item: Pick<GrowthItem, 'id' | 'next_step'>, today: string): GrowthLog {
  const step = item.next_step?.trim();
  return {
    update: { item_id: item.id, happened_on: today, note: step ? `Done: ${step}` : 'Done' },
    patch: { next_step: null, next_date: null },
  };
}

// ─── Add / edit form ───

export interface GrowthDraft {
  track: GrowthTrack;
  name: string;
  kind: GrowthKind;
  offer: string;
  stage: number;
  next_step: string;
  next_date: string;
  url: string;
  note: string;
}

export function emptyGrowthDraft(track: GrowthTrack): GrowthDraft {
  return { track, name: '', kind: KINDS_BY_TRACK[track][0], offer: '', stage: 1, next_step: '', next_date: '', url: '', note: '' };
}

export function draftFromItem(item: GrowthItem): GrowthDraft {
  return {
    track: item.track,
    name: item.name,
    kind: item.kind,
    offer: item.offer ?? '',
    stage: clampStage(item.stage),
    next_step: item.next_step ?? '',
    next_date: item.next_date ?? '',
    url: item.url ?? '',
    note: item.note ?? '',
  };
}

export type GrowthPayload = Pick<GrowthItem, 'track' | 'name' | 'kind' | 'offer' | 'stage' | 'next_step' | 'next_date' | 'url' | 'note'>;

/** The row as it should be written, or an error to show. Blank text is null; a bare domain gets https://. */
export function normalizeGrowthDraft(draft: GrowthDraft): { payload: GrowthPayload } | { error: string } {
  const name = draft.name.trim();
  if (!name) return { error: 'Add a name.' };
  if (!isGrowthKind(draft.kind)) return { error: 'Choose what it is.' };
  const text = (value: string) => value.trim() || null;
  const url = draft.url.trim();
  return {
    payload: {
      track: draft.track,
      name,
      kind: draft.kind,
      offer: text(draft.offer),
      stage: clampStage(draft.stage),
      next_step: text(draft.next_step),
      next_date: isCalendarDateKey(draft.next_date) ? draft.next_date : null,
      url: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
      note: text(draft.note),
    },
  };
}

// ─── Traction and the application text ───

export interface TractionFacts {
  usualMonth: number | null;
  regulars: number;
  leads: number;
  /** names of the programs Pat is in (funding, stage 5, open) */
  programs: string[];
}

export function programsIn(items: readonly GrowthItem[]): string[] {
  return items
    .filter(item => isOpen(item) && item.track === 'funding' && clampStage(item.stage) === 5)
    .map(item => item.name)
    .sort((a, b) => a.localeCompare(b));
}

function listEn(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function listTh(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(' ')} และ ${parts[parts.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A short paragraph for application forms and pitch emails, from the live numbers. */
export function applicationText(lang: 'en' | 'th', facts: TractionFacts): string {
  if (lang === 'th') {
    const numbers = [
      facts.usualMonth != null ? `ยอดขายเดือนปกติ ${formatBaht(facts.usualMonth)}` : null,
      facts.regulars > 0 ? `มีลูกค้าประจำ ${facts.regulars} รายที่สั่งซ้ำ` : null,
      facts.leads > 0 ? `มีลีดอีก ${facts.leads} รายรอติดต่อ` : null,
    ].filter((part): part is string => Boolean(part));
    return [
      'VG Saveur ผลิตเนยจากพืชสำหรับร้านเบเกอรี่ คาเฟ่ และร้านอาหารวีแกนในไทย',
      numbers.length > 0 ? listTh(numbers) : null,
      facts.programs.length > 0 ? `ได้รับการสนับสนุนจาก ${listTh(facts.programs)}` : null,
    ].filter(Boolean).join(' ');
  }
  const numbers = [
    facts.usualMonth != null ? `a usual month brings ${formatBaht(facts.usualMonth)} in sales` : null,
    facts.regulars > 0 ? `${plural(facts.regulars, 'regular buyer keeps', 'regular buyers keep')} reordering` : null,
    facts.leads > 0 ? `${plural(facts.leads, 'more lead is', 'more leads are')} lined up` : null,
  ].filter((part): part is string => Boolean(part));
  const sentence = listEn(numbers);
  // English drops the Thai abbreviation in brackets: "NIA (สนช.)" → "NIA".
  const programs = facts.programs.map(name => name.replace(/\s*\([^)]*\)\s*/g, ' ').trim()).filter(Boolean);
  return [
    'VG Saveur makes dairy-free butter for bakeries, cafés and vegan restaurants in Thailand.',
    sentence ? `${sentence[0].toUpperCase()}${sentence.slice(1)}.` : null,
    programs.length > 0 ? `We are supported by ${listEn(programs).replace(', and', ' and')}.` : null,
  ].filter(Boolean).join(' ');
}

// ─── Social: where buyers came from ───

export type ChannelWindow = '90d' | 'year';

export const CHANNEL_WINDOW_LABELS: Record<ChannelWindow, string> = { '90d': '90 days', year: 'This year' };

export const CHANNEL_LABELS: Record<AcquisitionSource, string> = {
  outbound: 'Your outreach',
  meta_ad: 'Meta ads',
  social_post: 'Social posts',
  press: 'Press & TV',
  referral: 'Referrals',
  inbound_other: 'Other inbound',
};

/** First day counted: 90 days back, or 1 January. */
export function windowStart(window: ChannelWindow, today: string): string {
  if (window === 'year') return `${today.slice(0, 4)}-01-01`;
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 90)).toISOString().slice(0, 10);
}

export interface ChannelRow {
  source: AcquisitionSource;
  label: string;
  /** accounts added in the window from this source */
  leads: number;
  /** of those, accounts with a won deal */
  won: number;
  /** invoiced sales from those accounts since the window began */
  sales: number;
}

export interface CampaignRow {
  name: string;
  source: AcquisitionSource;
  leads: number;
  won: number;
  sales: number;
}

export interface ChannelStats {
  rows: ChannelRow[];
  campaigns: CampaignRow[];
  /** accounts added in the window with no source recorded */
  notRecorded: number;
}

/**
 * The accounts added since `since`, counted by how they came in: how many, how many were
 * won, and what they have bought. A source is never inferred; unrecorded accounts are counted apart.
 */
export function channelStats(input: {
  companies: readonly Pick<Company, 'id' | 'created_at' | 'acquisition_source' | 'acquisition_campaign'>[];
  deals: readonly Pick<Deal, 'company_id' | 'stage'>[];
  salesByCompany: ReadonlyMap<string, number>;
  since: string;
}): ChannelStats {
  const wonCompanies = new Set(input.deals.filter(deal => deal.stage === 'closed_won' && deal.company_id).map(deal => deal.company_id!));
  const rows = new Map<AcquisitionSource, ChannelRow>();
  const campaigns = new Map<string, CampaignRow>();
  let notRecorded = 0;

  for (const company of input.companies) {
    if ((company.created_at ?? '').slice(0, 10) < input.since) continue;
    if (!isAcquisitionSource(company.acquisition_source)) {
      notRecorded += 1;
      continue;
    }
    const source = company.acquisition_source;
    const won = wonCompanies.has(company.id) ? 1 : 0;
    const sales = input.salesByCompany.get(company.id) ?? 0;
    const row = rows.get(source) ?? { source, label: CHANNEL_LABELS[source], leads: 0, won: 0, sales: 0 };
    row.leads += 1;
    row.won += won;
    row.sales += sales;
    rows.set(source, row);

    const name = company.acquisition_campaign?.trim();
    if (name) {
      const key = `${source}|${name.toLowerCase()}`;
      const campaign = campaigns.get(key) ?? { name, source, leads: 0, won: 0, sales: 0 };
      campaign.leads += 1;
      campaign.won += won;
      campaign.sales += sales;
      campaigns.set(key, campaign);
    }
  }

  const order = (a: { leads: number; sales: number }, b: { leads: number; sales: number }) => b.leads - a.leads || b.sales - a.sales;
  return { rows: [...rows.values()].sort(order), campaigns: [...campaigns.values()].sort(order), notRecorded };
}

/** "11 leads · 2 won · ฿5,200" */
export function resultLine(row: { leads: number; won: number; sales: number }): string {
  return [plural(row.leads, 'lead', 'leads'), `${row.won} won`, row.sales > 0 ? formatBaht(row.sales) : null].filter(Boolean).join(' · ');
}
