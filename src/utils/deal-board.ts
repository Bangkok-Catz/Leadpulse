// Type-only / relative imports deliberately: the Node-run report scripts load
// this module directly, so `@/` aliases do not resolve and a value import of a
// type has no runtime export. Same convention as retentionCadence.ts.
import type { CompanyStatus, CompStatus, Deal, SampleStatus } from '@/types/crm';
import { getWorkflowAction, isOnJourneyBoard } from './deal-workflow.ts';
import { daysBetween, inRetentionSystem, type ISODate } from './retentionCadence.ts';
import { businessDateKey } from './business-time.ts';

export type BoardAttentionFilter = 'all' | 'overdue' | 'today' | 'needs-review' | 'laya-review' | 'missing-data' | 'waiting-on-you' | 'stalled' | 'park-suggested';

/**
 * "do-now": overdue first, then by due date (the default). "hottest": highest tier first.
 * "quietest": longest since the last contact first, deals with no logged contact before all.
 */
export type BoardSort = 'do-now' | 'hottest' | 'quietest';

/** Cards shown per lane before "Show all"; a 100+ card lane cannot be scanned. */
export const LANE_CARD_CAP = 12;

/** The first LANE_CARD_CAP cards of a lane, unless expanded, and how many are hidden. */
export function capLane<T>(items: T[], expanded: boolean, cap: number = LANE_CARD_CAP): { shown: T[]; hiddenCount: number } {
  if (expanded || items.length <= cap) return { shown: items, hiddenCount: 0 };
  return { shown: items.slice(0, cap), hiddenCount: items.length - cap };
}

export interface DealBoardFilters {
  attention: BoardAttentionFilter;
  search: string;
  product: string | 'all';
  priority: Deal['priority'] | 'all';
  today: string;
  /** deal ids Laya routed to Pat (grade.ts needs_review); used by the 'laya-review' filter */
  layaReviewIds?: ReadonlySet<string>;
  /** deal ids with the selected data gap (deal-data-gaps.ts); used by the 'missing-data' filter */
  missingDataIds?: ReadonlySet<string>;
  /** deal ids where the buyer spoke last (waiting-on-you.ts); used by the 'waiting-on-you' filter */
  waitingOnYouIds?: ReadonlySet<string>;
  /** deal ids past their lane's stall threshold (lane-time.ts); used by the 'stalled' filter */
  stalledIds?: ReadonlySet<string>;
  /** deal ids at the nudge limit with no reply (park-suggestion.ts); used by the 'park-suggested' filter */
  parkSuggestedIds?: ReadonlySet<string>;
  sort?: BoardSort;
  /** dealId -> hotness (higher is hotter) for the 'hottest' sort; computed by the caller */
  hotness?: ReadonlyMap<string, number>;
  /** dealId -> date key of the last contact (last-contact.ts) for the 'quietest' sort; absent = never */
  lastContact?: ReadonlyMap<string, string>;
}

export interface DoNowCounts {
  all: number;
  overdue: number;
  today: number;
  needsReview: number;
  layaReview: number;
}

/**
 * Today's date key on the BUSINESS calendar (Asia/Bangkok), not the device's and not UTC.
 * Kept under this name because every board/detail/queue comparison already calls it; the
 * implementation moved so a phone in another timezone cannot disagree about a due date.
 */
export function localDateKey(date = new Date()): string {
  return businessDateKey(date);
}

export function dealDueState(deal: Deal, today: string): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!deal.followup_date || deal.stage === 'closed_won' || deal.stage === 'closed_lost') return 'none';
  if (getWorkflowAction(deal) === 'parked') return 'none';
  if (deal.followup_date < today) return 'overdue';
  if (deal.followup_date === today) return 'today';
  return 'upcoming';
}

const WAITING_FOR_RESPONSE_PATTERN = /\b(waiting|awaiting)\b.{0,80}\b(reply|response|feedback)\b|\bno response\b/i;
const PRE_CONTACT_ACTION_PATTERN = /\b(find|locate|identify|research|map)\b.{0,120}\b(buyer|contact|procurement|purchasing|r&d|decision.?maker|route)\b|before\s+(approach|outreach|contact)/i;

export type ReviewReason =
  | 'sample-status-missing'
  | 'testing-date-missing'
  | 'followup-date-missing'
  | 'parked-revisit-missing'
  | 'reply-outcome-missing'
  | 'pre-contact-action';

export const REVIEW_LABEL: Record<ReviewReason, string> = {
  'sample-status-missing': 'Sample missing sent/received status',
  'testing-date-missing': 'Testing missing a testing date',
  'followup-date-missing': 'Follow-up missing a date',
  'parked-revisit-missing': 'Parked missing a revisit date',
  'reply-outcome-missing': 'Waiting-on-reply missing last outreach confirmation',
  'pre-contact-action': 'Sample/testing started before contact researched',
};

export const REVIEW_FIX: Record<ReviewReason, string> = {
  'sample-status-missing': 'Confirm address / send intent (sample status Sent or Received).',
  'testing-date-missing': 'Add a testing date in the Testing lane.',
  'followup-date-missing': 'Add a follow-up date in the Follow-up lane.',
  'parked-revisit-missing': 'Add a revisit date when parking.',
  'reply-outcome-missing': 'Confirm last outreach was logged, or clear a "waiting for reply" next action.',
  'pre-contact-action': 'Resolve the pre-contact research step (find buyer/contact) before sample/testing.',
};

export function reviewReasons(deal: Deal): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  const action = getWorkflowAction(deal);
  const nextAction = deal.next_action?.trim() || '';

  if ((action === 'sample' || action === 'testing') && PRE_CONTACT_ACTION_PATTERN.test(nextAction)) {
    reasons.push('pre-contact-action');
  }

  switch (action) {
    case 'reply':
      if (!deal.last_outcome?.trim() || WAITING_FOR_RESPONSE_PATTERN.test(nextAction)) {
        reasons.push('reply-outcome-missing');
      }
      break;
    case 'sample':
      if (!deal.sample_status) reasons.push('sample-status-missing');
      break;
    case 'testing':
      if (!deal.followup_date) reasons.push('testing-date-missing');
      break;
    case 'reschedule':
      if (!deal.followup_date) reasons.push('followup-date-missing');
      break;
    case 'parked':
      if (!deal.followup_date) reasons.push('parked-revisit-missing');
      break;
    case 'success':
    case 'outreach':
    default:
      break;
  }

  return reasons;
}

export function dealNeedsReview(deal: Deal): boolean {
  return reviewReasons(deal).length > 0;
}

export interface ReviewItem {
  deal: Deal;
  lane: ReturnType<typeof getWorkflowAction>;
  reasons: ReviewReason[];
  labels: string[];
  fix: string;
}

export function buildReviewReport(deals: Deal[]): ReviewItem[] {
  return deals
    .filter(deal => dealNeedsReview(deal))
    .map(deal => {
      const reasons = reviewReasons(deal);
      return {
        deal,
        lane: getWorkflowAction(deal),
        reasons,
        labels: reasons.map(r => REVIEW_LABEL[r]),
        fix: reasons.map(r => REVIEW_FIX[r]).join(' '),
      };
    });
}

export function buildReviewFix(
  reasons: ReviewReason[],
  input: {
    sample_status?: SampleStatus | null;
    followup_date?: string | null;
    reply_outcome?: string | null;
    reply_summary?: string | null;
    next_action?: string | null;
  }
): Partial<Deal> {
  const updates: Partial<Deal> = {};
  const has = (r: ReviewReason) => reasons.includes(r);

  if (has('sample-status-missing') && input.sample_status) {
    updates.sample_status = input.sample_status;
  }
  if ((has('testing-date-missing') || has('parked-revisit-missing') || has('followup-date-missing')) && input.followup_date) {
    updates.followup_date = input.followup_date;
  }
  if (has('reply-outcome-missing') && input.reply_outcome) {
    const detail = input.reply_summary ? `: ${input.reply_summary}` : '';
    updates.last_outcome = `💬 Client replied — ${input.reply_outcome}${detail}`;
  }
  if (has('pre-contact-action') && input.next_action?.trim()) {
    updates.next_action = input.next_action.trim();
  }

  return updates;
}

const PRIORITY_RANK: Record<Deal['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const TEXT_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function doNowBucket(deal: Deal, today: string): number {
  const dueState = dealDueState(deal, today);
  if (dueState === 'overdue') return 0;
  if (dueState === 'today') return 1;
  if (dueState === 'upcoming') return 2;
  if (deal.priority === 'high') return 3;
  return 4;
}

export function sortDealsForDoNow(deals: Deal[], today: string): Deal[] {
  return [...deals].sort((a, b) => {
    const bucketDifference = doNowBucket(a, today) - doNowBucket(b, today);
    if (bucketDifference !== 0) return bucketDifference;

    const bucket = doNowBucket(a, today);
    if (bucket <= 2) {
      const dateDifference = (a.followup_date || '').localeCompare(b.followup_date || '');
      if (dateDifference !== 0) return dateDifference;
    }

    const priorityDifference = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDifference !== 0) return priorityDifference;

    const clientDifference = TEXT_COLLATOR.compare(a.client, b.client);
    if (clientDifference !== 0) return clientDifference;

    const titleDifference = TEXT_COLLATOR.compare(a.title, b.title);
    if (titleDifference !== 0) return titleDifference;

    return a.id.localeCompare(b.id);
  });
}

export function filterAndSortBoardDeals(deals: Deal[], filters: DealBoardFilters): Deal[] {
  const search = filters.search.trim().toLocaleLowerCase();

  const filtered = deals.filter(deal => {
    void isOnJourneyBoard;
    const dueState = dealDueState(deal, filters.today);
    if (filters.attention === 'overdue' && dueState !== 'overdue') return false;
    if (filters.attention === 'today' && dueState !== 'today') return false;
    if (filters.attention === 'needs-review' && !dealNeedsReview(deal)) return false;
    if (filters.attention === 'laya-review' && !filters.layaReviewIds?.has(deal.id)) return false;
    if (filters.attention === 'missing-data' && !filters.missingDataIds?.has(deal.id)) return false;
    if (filters.attention === 'waiting-on-you' && !filters.waitingOnYouIds?.has(deal.id)) return false;
    if (filters.attention === 'stalled' && !filters.stalledIds?.has(deal.id)) return false;
    if (filters.attention === 'park-suggested' && !filters.parkSuggestedIds?.has(deal.id)) return false;

    if (search) {
      const searchable = `${deal.client} ${deal.title}`.toLocaleLowerCase();
      if (!searchable.includes(search)) return false;
    }

    if (filters.product !== 'all' && deal.product !== filters.product) return false;
    if (filters.priority !== 'all' && deal.priority !== filters.priority) return false;

    return true;
  });

  const doNow = sortDealsForDoNow(filtered, filters.today);
  if (filters.sort === 'quietest') {
    // Oldest contact first; '' (no logged contact) sorts before any date. Equal dates keep the do-now order.
    const last = (deal: Deal) => filters.lastContact?.get(deal.id) ?? '';
    return doNow.sort((a, b) => last(a).localeCompare(last(b)));
  }
  if (filters.sort !== 'hottest') return doNow;
  // Hottest first; equal hotness keeps the do-now order (Array.prototype.sort is stable).
  const hot = (deal: Deal) => filters.hotness?.get(deal.id) ?? 0;
  return doNow.sort((a, b) => hot(b) - hot(a));
}

/**
 * Deals matching a search once the board's own filters are set aside.
 * Backs the "Search all deals" escape: a deal that exists but is filtered out must never look
 * missing, and the query is preserved across the switch. An empty query matches nothing.
 */
export function findDealsMatchingSearch(deals: Deal[], search: string, today: string): Deal[] {
  if (!search.trim()) return [];
  return filterAndSortBoardDeals(deals, {
    search,
    attention: 'all',
    product: 'all',
    priority: 'all',
    today,
  });
}

export function getDoNowCounts(deals: Deal[], today: string, layaReviewIds?: ReadonlySet<string>): DoNowCounts {
  return deals.reduce<DoNowCounts>((counts, deal) => {
    const dueState = dealDueState(deal, today);
    counts.all += 1;
    if (dueState === 'overdue') counts.overdue += 1;
    if (dueState === 'today') counts.today += 1;
    if (dealNeedsReview(deal)) counts.needsReview += 1;
    if (layaReviewIds?.has(deal.id)) counts.layaReview += 1;
    return counts;
  }, { all: 0, overdue: 0, today: 0, needsReview: 0, layaReview: 0 });
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT-LEVEL ATTENTION — revenue signal detector (spec rev 2, 2026-09-14)
//
// Sibling to `ReviewReason`, deliberately NOT a parallel intelligence module and
// NOT forced into the deal union: an account signal by definition has no open
// deal to attach to (that is the finding — the pipeline cannot see a customer
// who is demonstrably buying). Same shape, same conventions: typed union +
// label map + fix map.
//
// READ-ONLY. Nothing below writes, and nothing below is wired into a surface.
// The deals-vs-pipeline / nudges-vs-signals consolidation is undecided, so the
// detector stays surface-independent by design.
//
// Payment/comp note: `paid-vs-free` is NOT derivable from this schema (verified
// 2026-09-14 — no payment column exists anywhere in `public`). Nothing here may
// infer payment from order value or `is_zero_value`. Signals that need it stay
// unbuilt until the proposed migration lands.
// ─────────────────────────────────────────────────────────────────────────────

export type AccountReason =
  | 'reorder-gap'
  | 'customer-no-won-deal'
  | 'status-hides-customer';

export const ACCOUNT_REVIEW_LABEL: Record<AccountReason, string> = {
  'reorder-gap': 'Active customer past their own reorder cycle',
  'customer-no-won-deal': 'Buying with no recorded won deal',
  'status-hides-customer': 'Won deal, but status hides them from retention',
};

export const ACCOUNT_REVIEW_FIX: Record<AccountReason, string> = {
  'reorder-gap': 'Ask about the next order — the silence is longer than their own ordering cycle.',
  'customer-no-won-deal': 'Review the record and propose a won deal. Never backdate one.',
  'status-hides-customer': 'Propose the status correction so retention can see them (a write — needs Pat’s approval).',
};

/** Every reason, in evaluation-offer order. */
export const ACCOUNT_REASONS: AccountReason[] = [
  'reorder-gap',
  'customer-no-won-deal',
  'status-hides-customer',
];

/**
 * ONE config block. No threshold is hardcoded in the detection logic.
 * Defaults are the spec author's, NOT measured from Pat's data — see the report
 * header, which publishes them alongside every number they produced.
 */
export interface AccountSignalConfig {
  /** "Active customer, ≥ 3 orders" — minimum orders before a cycle can be derived. */
  minOrdersForInterval: number;
  /** "silence > multiplier × their own median inter-order interval". */
  reorderGapMultiplier: number;
  /** Minimum orders for "has order history but no won deal". */
  minOrdersForContradiction: number;
  /** Revenue-at-risk weight per reason. Ranks signals; never changes whether one fires. */
  revenueAtRiskWeight: Record<AccountReason, number>;
}

export const ACCOUNT_SIGNAL_CONFIG: AccountSignalConfig = {
  minOrdersForInterval: 3,
  reorderGapMultiplier: 1.5,
  minOrdersForContradiction: 1,
  revenueAtRiskWeight: {
    'reorder-gap': 1,
    'status-hides-customer': 0.8,
    'customer-no-won-deal': 0.5,
  },
};

export type AccountSignalStatus = 'fired' | 'clear' | 'not_applicable' | 'insufficient';

/**
 * Why a signal could not be evaluated. `unknown` is a valid outcome — an
 * unevidenced signal stays OFF rather than firing on a guess.
 */
export type AccountInsufficientReason =
  | 'no_order_history'
  | 'orders_below_minimum'
  | 'interval_undeterminable'
  | 'status_missing_or_unrecognised';

export type AccountDisposition = 'signalled' | 'insufficient_data' | 'clear';

export interface AccountOrderRow {
  date: ISODate;
  amount: number;
}

export interface AccountDealRow {
  stage: string;
  value: number | null;
}

export interface AccountInputRow {
  id: string;
  name: string;
  status: string | null;
  orders: AccountOrderRow[];
  deals: AccountDealRow[];
}

export interface AccountSignalResult {
  reason: AccountReason;
  status: AccountSignalStatus;
  insufficient_reason?: AccountInsufficientReason;
  /** What the record shows. Never why the buyer did it. */
  evidence: string[];
  metrics?: Record<string, number | string | null>;
}

// Compile-time guard: a new CompanyStatus member fails this file's typecheck
// instead of silently becoming "unrecognised" at runtime.
const RECOGNISED_COMPANY_STATUS: Record<CompanyStatus, true> = {
  prospect: true,
  active_customer: true,
  inactive: true,
  lost: true,
  closed: true,
};

function isRecognisedCompanyStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return Object.prototype.hasOwnProperty.call(RECOGNISED_COMPANY_STATUS, status);
}

/** Median gap between consecutive orders. Null with fewer than two orders. */
export function medianInterOrderDays(orders: AccountOrderRow[]): number | null {
  const sorted = [...orders].sort((a, b) => a.date.localeCompare(b.date));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * Median recorded order value. "Trailing" = every order row in the corpus read;
 * there is no separate trailing window in the schema, so none is invented.
 */
export function medianOrderValue(orders: AccountOrderRow[]): number | null {
  const values = orders
    .map(order => order.amount)
    .filter(amount => Number.isFinite(amount))
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Most recent recorded order date, or null when the account has no orders. */
export function lastOrderDate(orders: AccountOrderRow[]): ISODate | null {
  if (orders.length === 0) return null;
  const dates = orders.map(order => order.date).sort();
  return dates[dates.length - 1];
}

/**
 * Evaluate every account-level reason for one account.
 * Returns one result per reason, always in ACCOUNT_REASONS order, so a caller
 * can never conclude "no signal" from an absent entry.
 */
export function evaluateAccountSignals(
  account: AccountInputRow,
  config: AccountSignalConfig = ACCOUNT_SIGNAL_CONFIG,
  today: ISODate,
): AccountSignalResult[] {
  const results: AccountSignalResult[] = [];
  const orders = account.orders;
  const orderCount = orders.length;
  const statusRecognised = isRecognisedCompanyStatus(account.status);
  const visibleToRetention = statusRecognised && inRetentionSystem(account.status as string);
  const wonDeals = account.deals.filter(deal => deal.stage === 'closed_won');

  const sortedDates = orders.map(order => order.date).sort();
  const lastOrder = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null;
  const silenceDays = lastOrder ? daysBetween(lastOrder, today) : null;
  const medianGap = medianInterOrderDays(orders);

  // ── 1. reorder-gap ────────────────────────────────────────────────────────
  if (!statusRecognised) {
    results.push({
      reason: 'reorder-gap',
      status: 'insufficient',
      insufficient_reason: 'status_missing_or_unrecognised',
      evidence: [
        `Retention scope cannot be determined: account status is ${
          account.status ? `"${account.status}"` : 'empty'
        }, which is not one of the four known statuses.`,
      ],
    });
  } else if (!visibleToRetention) {
    results.push({
      reason: 'reorder-gap',
      status: 'not_applicable',
      evidence: [`Not an active customer (status "${account.status}") — retention scope only.`],
    });
  } else if (orderCount === 0) {
    results.push({
      reason: 'reorder-gap',
      status: 'insufficient',
      insufficient_reason: 'no_order_history',
      evidence: ['Status says active_customer, but no order rows were found for this account.'],
    });
  } else if (orderCount < config.minOrdersForInterval) {
    results.push({
      reason: 'reorder-gap',
      status: 'insufficient',
      insufficient_reason: 'orders_below_minimum',
      evidence: [
        `${orderCount} order(s) recorded; ${config.minOrdersForInterval} are required to derive an ordering cycle.`,
      ],
      metrics: { order_count: orderCount },
    });
  } else if (medianGap === null || medianGap <= 0) {
    results.push({
      reason: 'reorder-gap',
      status: 'insufficient',
      insufficient_reason: 'interval_undeterminable',
      evidence: [
        `${orderCount} orders, but the median gap between them is ${
          medianGap === null ? 'undefined' : '0 days'
        } — orders arrive in bursts, so there is no cycle to be late against.`,
      ],
      metrics: { order_count: orderCount, median_gap_days: medianGap },
    });
  } else {
    const thresholdDays = medianGap * config.reorderGapMultiplier;
    const fired = silenceDays !== null && silenceDays > thresholdDays;
    results.push({
      reason: 'reorder-gap',
      status: fired ? 'fired' : 'clear',
      evidence: [
        `${orderCount} orders; median gap ${Math.round(medianGap)} days → threshold ${Math.round(
          thresholdDays,
        )} days at ${config.reorderGapMultiplier}×.`,
        `Last order was ${silenceDays} days ago (${lastOrder}).`,
      ],
      metrics: {
        order_count: orderCount,
        median_gap_days: medianGap,
        threshold_days: thresholdDays,
        silence_days: silenceDays,
        last_order: lastOrder,
      },
    });
  }

  // ── 2. customer-no-won-deal ───────────────────────────────────────────────
  if (!statusRecognised) {
    results.push({
      reason: 'customer-no-won-deal',
      status: 'insufficient',
      insufficient_reason: 'status_missing_or_unrecognised',
      evidence: [
        `Customer status is ${
          account.status ? `"${account.status}"` : 'empty'
        }, which is not one of the four known statuses.`,
      ],
    });
  } else if (!visibleToRetention) {
    results.push({
      reason: 'customer-no-won-deal',
      status: 'not_applicable',
      evidence: [`Not an active customer (status "${account.status}").`],
    });
  } else if (orderCount < config.minOrdersForContradiction) {
    results.push({
      reason: 'customer-no-won-deal',
      status: 'insufficient',
      insufficient_reason: 'no_order_history',
      evidence: ['No order history recorded, so no customer claim can be contradicted.'],
    });
  } else if (wonDeals.length > 0) {
    results.push({
      reason: 'customer-no-won-deal',
      status: 'clear',
      evidence: [`${wonDeals.length} won deal(s) recorded alongside ${orderCount} order(s).`],
    });
  } else {
    results.push({
      reason: 'customer-no-won-deal',
      status: 'fired',
      evidence: [
        `Status active_customer with ${orderCount} order(s) recorded, but no closed_won deal exists.`,
      ],
      metrics: { order_count: orderCount, won_deals: 0 },
    });
  }

  // ── 3. status-hides-customer ──────────────────────────────────────────────
  if (wonDeals.length === 0) {
    results.push({
      reason: 'status-hides-customer',
      status: 'clear',
      evidence: ['No closed_won deal recorded for this account.'],
    });
  } else if (!statusRecognised) {
    results.push({
      reason: 'status-hides-customer',
      status: 'insufficient',
      insufficient_reason: 'status_missing_or_unrecognised',
      evidence: [
        `Holds ${wonDeals.length} won deal(s), but the account status is ${
          account.status ? `"${account.status}"` : 'empty'
        } — not one of the four known statuses, so retention visibility cannot be determined.`,
      ],
    });
  } else if (visibleToRetention) {
    results.push({
      reason: 'status-hides-customer',
      status: 'clear',
      evidence: [
        `Holds ${wonDeals.length} won deal(s) and status is active_customer — visible to retention.`,
      ],
    });
  } else {
    results.push({
      reason: 'status-hides-customer',
      status: 'fired',
      evidence: [
        `Holds ${wonDeals.length} won deal(s) while status is "${account.status}" — outside retention scope (active_customer only).`,
      ],
      metrics: { won_deals: wonDeals.length },
    });
  }

  return results;
}

/** Account-level rollup. A fired reason wins; else insufficient; else clear. */
export function accountDisposition(results: AccountSignalResult[]): AccountDisposition {
  if (results.some(result => result.status === 'fired')) return 'signalled';
  if (results.some(result => result.status === 'insufficient')) return 'insufficient_data';
  return 'clear';
}

export interface AccountSignalItem {
  account_id: string;
  account_name: string;
  reason: AccountReason;
  label: string;
  fix: string;
  weight: number;
  median_order_value: number | null;
  revenue_at_risk: number;
  revenue_basis: 'trailing_median_order_value' | 'none';
  /** Most recent recorded order. Null when the account has never ordered. */
  last_order_date: ISODate | null;
  /** Days since that order. Null when there is no last order. Primary sort key. */
  days_since_last_order: number | null;
  evidence: string[];
}

export interface AccountInsufficientItem {
  account_id: string;
  account_name: string;
  reason: AccountReason;
  insufficient_reason: AccountInsufficientReason;
  evidence: string[];
}

export interface AccountClearItem {
  account_id: string;
  account_name: string;
  reasons_evaluated: AccountReason[];
}

export interface AccountSignalReport {
  generated_at: string;
  source: string;
  formula: string;
  /** How the ranked list is ordered. Published so no rank is unexplained. */
  rank_rule: string;
  config: AccountSignalConfig;
  /** Rows actually read per source table. Makes a silent fetch cap visible. */
  corpus: Record<string, number>;
  /**
   * Loud, non-optional caveats. An unreadable source must appear HERE, not as a
   * silently-zero signal count — a blocked read and a genuine "nothing found"
   * are different answers and must never be reported as the same thing.
   */
  warnings: string[];
  counts: {
    accounts_in: number;
    signalled_accounts: number;
    insufficient_accounts: number;
    clear_accounts: number;
    signals_total: number;
    by_reason: Record<AccountReason, number>;
    by_status: Record<AccountReason, Record<AccountSignalStatus, number>>;
    insufficient_by_reason: Record<AccountInsufficientReason, number>;
  };
  reconciliation: {
    accounts_in: number;
    signalled: number;
    insufficient: number;
    clear: number;
    sum: number;
    ok: boolean;
  };
  signals: AccountSignalItem[];
  insufficient: AccountInsufficientItem[];
  clear: AccountClearItem[];
  notes: string[];
}

const ACCOUNT_REPORT_FORMULA =
  'revenue_at_risk = trailing_median_order_value × weight[reason]';

/**
 * Recency leads, money follows. A 480-day silence against a 131-day habit is a
 * lost account; ranking it first is archaeology. Thresholds are NOT affected by
 * this — it orders the output only.
 */
const ACCOUNT_REPORT_RANK_RULE =
  'sort: days_since_last_order ASC (never-ordered last), then revenue_at_risk DESC, then name';

/**
 * Build the ranked account-level report. Pure: takes rows, returns a value.
 * EVERY account lands in exactly one of signalled / insufficient / clear, and
 * the reconciliation proves the partition sums to the population — silent
 * exclusion is the defect this guards against.
 */
export function buildAccountSignalReport(
  rows: AccountInputRow[],
  options: {
    source: string;
    now: Date;
    config?: AccountSignalConfig;
    corpus?: Record<string, number>;
    warnings?: string[];
  },
): AccountSignalReport {
  const config = options.config ?? ACCOUNT_SIGNAL_CONFIG;
  const today = localDateKey(options.now);

  const byReason = {} as Record<AccountReason, number>;
  const byStatus = {} as Record<AccountReason, Record<AccountSignalStatus, number>>;
  const insufficientByReason = {} as Record<AccountInsufficientReason, number>;
  for (const reason of ACCOUNT_REASONS) {
    byReason[reason] = 0;
    byStatus[reason] = { fired: 0, clear: 0, not_applicable: 0, insufficient: 0 };
  }
  for (const reason of [
    'no_order_history',
    'orders_below_minimum',
    'interval_undeterminable',
    'status_missing_or_unrecognised',
  ] as AccountInsufficientReason[]) {
    insufficientByReason[reason] = 0;
  }

  const signals: AccountSignalItem[] = [];
  const insufficient: AccountInsufficientItem[] = [];
  const clear: AccountClearItem[] = [];
  let signalledAccounts = 0;
  let insufficientAccounts = 0;
  let clearAccounts = 0;

  for (const row of rows) {
    const results = evaluateAccountSignals(row, config, today);
    const disposition = accountDisposition(results);

    for (const result of results) {
      byStatus[result.reason][result.status] += 1;
      if (result.status === 'fired') {
        byReason[result.reason] += 1;
        const median = medianOrderValue(row.orders);
        const weight = config.revenueAtRiskWeight[result.reason];
        const lastOrder = lastOrderDate(row.orders);
        signals.push({
          account_id: row.id,
          account_name: row.name,
          reason: result.reason,
          label: ACCOUNT_REVIEW_LABEL[result.reason],
          fix: ACCOUNT_REVIEW_FIX[result.reason],
          weight,
          median_order_value: median,
          revenue_at_risk: median === null ? 0 : median * weight,
          revenue_basis: median === null ? 'none' : 'trailing_median_order_value',
          last_order_date: lastOrder,
          days_since_last_order: lastOrder === null ? null : daysBetween(lastOrder, today),
          evidence: result.evidence,
        });
      }
      if (result.status === 'insufficient' && result.insufficient_reason) {
        insufficientByReason[result.insufficient_reason] += 1;
        insufficient.push({
          account_id: row.id,
          account_name: row.name,
          reason: result.reason,
          insufficient_reason: result.insufficient_reason,
          evidence: result.evidence,
        });
      }
    }

    if (disposition === 'signalled') signalledAccounts += 1;
    else if (disposition === 'insufficient_data') insufficientAccounts += 1;
    else {
      clearAccounts += 1;
      clear.push({
        account_id: row.id,
        account_name: row.name,
        reasons_evaluated: ACCOUNT_REASONS,
      });
    }
  }

  // RECENCY FIRST, then money. Variables were renamed in the comparator so the
  // primary key cannot be mistaken for the secondary one.
  signals.sort((a, b) => {
    const aDays = a.days_since_last_order;
    const bDays = b.days_since_last_order;
    // An account with no recorded order has no recency evidence: it sorts last.
    if (aDays === null && bDays !== null) return 1;
    if (bDays === null && aDays !== null) return -1;
    if (aDays !== null && bDays !== null && aDays !== bDays) return aDays - bDays;

    if (b.revenue_at_risk !== a.revenue_at_risk) return b.revenue_at_risk - a.revenue_at_risk;
    const byName = a.account_name.localeCompare(b.account_name);
    if (byName !== 0) return byName;
    return ACCOUNT_REASONS.indexOf(a.reason) - ACCOUNT_REASONS.indexOf(b.reason);
  });

  const sum = signalledAccounts + insufficientAccounts + clearAccounts;

  return {
    generated_at: options.now.toISOString(),
    source: options.source,
    formula: ACCOUNT_REPORT_FORMULA,
    rank_rule: ACCOUNT_REPORT_RANK_RULE,
    config,
    corpus: options.corpus ?? {},
    warnings: options.warnings ?? [],
    counts: {
      accounts_in: rows.length,
      signalled_accounts: signalledAccounts,
      insufficient_accounts: insufficientAccounts,
      clear_accounts: clearAccounts,
      signals_total: signals.length,
      by_reason: byReason,
      by_status: byStatus,
      insufficient_by_reason: insufficientByReason,
    },
    reconciliation: {
      accounts_in: rows.length,
      signalled: signalledAccounts,
      insufficient: insufficientAccounts,
      clear: clearAccounts,
      sum,
      ok: sum === rows.length,
    },
    signals,
    insufficient,
    clear,
    notes: [
      'Deal-level signals (meeting-not-booked, sample-stalled-no-meeting, paid-test-no-conversion) are NOT built: they depend on payment/comp data that does not exist in the schema and on touch logging that is too thin to count (11.9% of deals carry any logged touch). See the 2026-09-14 findings.',
      'Payment status is unknown for every account. paid-vs-free is never inferred from order value or is_zero_value.',
      'Thresholds are the spec author’s defaults, not measured from Pat’s data.',
      'Read-only: no CRM write occurs on this path. Wiring into a surface is out of scope pending the deals/pipeline and nudges/signals decision.',
    ],
  };
}

export function renderAccountSignalReport(report: AccountSignalReport): string {
  const lines: string[] = [];
  const money = (n: number) => `฿${Math.round(n).toLocaleString('en-US')}`;

  lines.push('ACCOUNT-LEVEL REVENUE SIGNALS (read-only)');
  lines.push(`generated: ${report.generated_at}`);
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('!! WARNINGS — READ BEFORE TRUSTING ANY COUNT BELOW !!');
    for (const warning of report.warnings) lines.push(`  !! ${warning}`);
    lines.push('');
  }
  lines.push(`source:    ${report.source}`);
  lines.push(`formula:   ${report.formula}`);
  lines.push(`ranking:   ${report.rank_rule}`);
  lines.push(
    `config:    minOrdersForInterval=${report.config.minOrdersForInterval} ` +
      `reorderGapMultiplier=${report.config.reorderGapMultiplier} ` +
      `minOrdersForContradiction=${report.config.minOrdersForContradiction}`,
  );
  lines.push(
    `weights:   ${ACCOUNT_REASONS.map(r => `${r}=${report.config.revenueAtRiskWeight[r]}`).join(' ')}`,
  );
  const corpusKeys = Object.keys(report.corpus);
  if (corpusKeys.length > 0) {
    lines.push(`corpus:    ${corpusKeys.map(k => `${k}=${report.corpus[k]}`).join(' ')}`);
  }
  lines.push('');
  lines.push(
    `population: ${report.reconciliation.accounts_in} accounts → ` +
      `signalled=${report.reconciliation.signalled} ` +
      `insufficient=${report.reconciliation.insufficient} ` +
      `clear=${report.reconciliation.clear} ` +
      `sum=${report.reconciliation.sum} ok=${report.reconciliation.ok}`,
  );
  lines.push(
    `signals:    ${report.counts.signals_total} across ${report.reconciliation.signalled} account(s)`,
  );
  lines.push(
    `per reason: ${ACCOUNT_REASONS.map(r => `${r}=${report.counts.by_reason[r]}`).join(' ')}`,
  );
  lines.push('');
  lines.push('── deal-level signals ──');
  lines.push('  NOT BUILT in this slice: meeting-not-booked, sample-stalled-no-meeting,');
  lines.push('  paid-test-no-conversion. Blocked on payment/comp data (no schema field exists)');
  lines.push('  and on touch logging too thin to count. Their next steps differ from the');
  lines.push('  account-level ones, so they are reported as absent rather than folded in.');
  lines.push('');
  lines.push('── ranked account signals ──');
  if (report.signals.length === 0) {
    lines.push('  (none fired)');
  }
  for (const [index, signal] of report.signals.entries()) {
    const recency =
      signal.last_order_date === null
        ? 'last order: none recorded'
        : `last order ${signal.last_order_date} (${signal.days_since_last_order}d ago)`;
    lines.push(
      `  ${index + 1}. ${signal.account_name} — ${signal.reason} — ${recency} — ` +
        `revenue at risk ${money(signal.revenue_at_risk)} ` +
        `(basis: ${signal.revenue_basis}` +
        `${signal.median_order_value === null ? '' : `, median order ${money(signal.median_order_value)}`}, ×${signal.weight})`,
    );
    lines.push(`     ${signal.label}`);
    lines.push(`     fix: ${signal.fix}`);
    for (const evidence of signal.evidence) lines.push(`     · ${evidence}`);
  }
  lines.push('');
  lines.push(`── insufficient_data (${report.insufficient.length} entries, every reason recorded) ──`);
  if (report.insufficient.length === 0) lines.push('  (none)');
  for (const item of report.insufficient) {
    lines.push(`  ${item.account_name} — ${item.reason} — ${item.insufficient_reason}`);
    for (const evidence of item.evidence) lines.push(`     · ${evidence}`);
  }
  lines.push('');
  lines.push(
    `── clear (${report.clear.length} accounts, listed in the JSON artifact) — evaluated, nothing fired ──`,
  );
  lines.push('');
  lines.push('── per-reason status matrix ──');
  for (const reason of ACCOUNT_REASONS) {
    const row = report.counts.by_status[reason];
    lines.push(
      `  ${reason}: fired=${row.fired} clear=${row.clear} not_applicable=${row.not_applicable} insufficient=${row.insufficient}`,
    );
  }
  lines.push('');
  lines.push('── notes ──');
  for (const note of report.notes) lines.push(`  · ${note}`);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment/comp writer payload (proposed migration 20260914_add_deal_comp_status)
//
// Shipped in the same slice as the field, per "no column without its writer".
// It NEVER guesses: an unrecognised or missing value resolves to 'unknown', and
// nothing is ever derived from order value or is_zero_value.
//
// NOT YET LIVE: `deals.comp_status` / `deals.paid_test_date` do not exist until
// the proposed migration is applied (it is deliberately unapplied). Calling the
// app's update path with these keys before then fails with 42703. No surface
// writes them yet — UI wiring is out of scope for this slice.
// ─────────────────────────────────────────────────────────────────────────────

export function buildCompStatusUpdate(input: {
  comp_status?: CompStatus | string | null;
  paid_test_date?: string | null;
}): Partial<Deal> {
  const updates: Partial<Deal> = {};

  // Only touch a key the caller actually sent — a paid_test_date-only call must
  // never silently overwrite a known paid/comped value with 'unknown'.
  if ('comp_status' in input) {
    const raw = input.comp_status;
    updates.comp_status = raw === 'paid' || raw === 'comped' ? raw : 'unknown';
  }
  if ('paid_test_date' in input) {
    const raw = input.paid_test_date;
    updates.paid_test_date = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  return updates;
}
