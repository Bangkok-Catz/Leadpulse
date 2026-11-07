// ─── Deal grade: deterministic tier, adjusted by saved Laya judgments ───
// Pure code. Never calls a model: it reads one saved judgment of the deal set
// (laya_judgments / laya-questions.json "terminal") plus CRM facts, and returns
// a grade with its reasons. Nothing here changes a deal or contacts anyone.
//
// The loop, in order:
//   1. Deterministic gates — closed/parked, no verbatim reply, no fresh judgment →
//      no model grade; the deterministic tier stands alone.
//   2. Human review — a refused judgment, an incomplete answer set, or any key answer
//      the reader is unsure of → "needs_review" for Pat, with the reason. A Thai reply
//      goes to Pat unless LFM3 has read it (Laya never reads Thai).
//   2c. A Thai reply is graded only from LFM3's reading (Laya never reads Thai): in full
//      when LFM3 answered the whole deal set, from the reply type alone when it read only
//      buyer_response (the older "buyer" set).
//
// Who answered the trial and concern questions matters: Laya's signal-tier answers count
// once they pass their tuned cut-off (laya-cutoffs.json); LFM3's are weighed by their
// probability like every other answer, and one inside the unsure band goes to Pat. LFM3's
// cut-offs could not be tuned (the dev set has 2–5 yes replies per question).
//   3. Momentum — a weighted sum over the answers laya-cutoffs.json allows to count,
//      plus code signals (order quantity, chases since the last reply).
//   4. Tier shift — the deterministic tier (lead-scoring.ts) moves up or down by
//      momentum.
//
// Weights are a first guess, NOT calibrated: tune them against real replies as
// they arrive. Cut-offs and tiers come from laya-cutoffs.json (tuned 2026-10-01).

import type { Deal } from '@/types/crm';
import LAYA_CUTOFFS from './laya-cutoffs.json';
import { hasThaiScript } from './laya-buyer-response';
import { calculateLeadScore, scoreToTier, type LeadTier } from './lead-scoring';
import { kilogramsStated, quantityTier, type QuantityTier } from './order-quantity';

/** A saved answer as the worker stores it: a Choice carries probabilities, a Noul a value. */
export interface SavedAnswer {
  probabilities?: Record<string, number>;
  noul?: number;
}

export interface SavedJudgment {
  status: 'scored' | 'not_scored';
  not_scored_code?: string | null;
  answers?: Record<string, SavedAnswer> | null;
  /** true only when the judgment's input hash matches the deal's CURRENT reply */
  fresh: boolean;
  /** LFM3's reading alone (buyer_response only), on a reply Laya has no row for */
  replyOnly?: boolean;
  /** who read the reply; Laya when absent, unless it is a lone LFM3 reading (replyOnly) */
  reader?: Reader;
}

/** The model behind a saved deal-set judgment. */
export type Reader = 'laya' | 'lfm3';

export type GradeStatus = 'graded' | 'needs_review' | 'not_graded';

/** Where a reason comes from: what the buyer said (Laya), Pat's follow-up, or the order size. */
export type ReasonGroup = 'buyer' | 'followup' | 'order';

export interface GradeReason {
  label: string;
  /** contribution to momentum; 0 for display-only notes */
  effect: number;
  group?: ReasonGroup;
  /** the probability behind a weighted answer; absent for yes/no signals and code facts */
  strength?: number;
}

/** How Laya's reading of the reply moved against the previous reply on the same deal. */
export interface ReplyTrend {
  direction: 'up' | 'down' | 'steady';
  /** change in the buyer-reply part of momentum */
  delta: number;
}

export interface DealGrade {
  status: GradeStatus;
  /** the deterministic tier from CRM fields alone */
  baseTier: LeadTier;
  /** the tier to show: shifted only when status is "graded" */
  tier: LeadTier;
  /** what the tier would be if Pat confirms a needs_review grade; null without momentum */
  suggestedTier: LeadTier | null;
  momentum: number | null;
  reasons: GradeReason[];
  /** why the deal goes to Pat (needs_review) or was not graded (not_graded) */
  review: string[];
  quantity: QuantityTier;
  /** P(the buyer asked for a next step), when a fresh complete judgment exists */
  pRequestedNextStep?: number;
  /** set by the callers that have the deal's judgment history (laya-trend.ts) */
  trend?: ReplyTrend;
  /** Pat's decision on a needs_review grade for this reply (laya-decisions.ts) */
  decision?: 'confirm' | 'reject';
}

export interface GradeInput {
  deal: Deal;
  judgment: SavedJudgment | null;
  /** chasesSinceLastReply() from interaction-event.ts */
  chasesSinceReply: number;
}

/** Uncalibrated first weights — tune against real replies. */
export const GRADE_WEIGHTS = {
  requestedNextStep: 0.3,
  declined: -0.4,
  deferred: -0.1,
  trialReported: 0.05,
  trialPositive: 0.2,
  trialNegative: -0.2,
  concernPrice: -0.1,
  concernTechnical: -0.15,
  concernDelivery: -0.05,
  concernTiming: -0.05,
  nextStepCommitment: 0.1,
  quantity: { none: 0, small: 0.05, moderate: 0.1, large: 0.15 } as Record<QuantityTier, number>,
  perChaseSinceReply: -0.08,
  maxChases: 4,
} as const;

/** Shown on a graded Thai reply: what LFM3 read, and what was never asked. */
export const THAI_READ_NOTE = 'Thai reply read by LFM3: reply type only, no trial or concern questions';

/** Momentum needed to move the tier: one step at ±0.25, a second step down at −0.5. */
export const TIER_SHIFT = { up: 0.25, down: -0.25, downTwo: -0.5 } as const;

/** A probability inside this band counts as Laya being unsure. */
export const UNSURE_BAND = { low: 0.35, high: 0.65 } as const;
/** A signal-tier Noul this close to its cut-off counts as unsure. */
export const NEAR_CUTOFF = 0.1;

const TIERS: LeadTier[] = ['D', 'C', 'B', 'A', 'S'];
const DEAL_CUTOFFS = LAYA_CUTOFFS.deal as Record<string, { tier: string; cutoff?: number }>;
const DEAL_SET = Object.keys(DEAL_CUTOFFS);

const LABELS: Record<string, string> = {
  trial_reported: 'buyer reported on our sample',
  trial_positive: 'buyer reported a good trial',
  concern_price: 'price concern',
  concern_technical: 'product performance concern',
};

function shiftTier(tier: LeadTier, momentum: number): LeadTier {
  const steps = momentum >= TIER_SHIFT.up ? 1 : momentum <= TIER_SHIFT.downTwo ? -2 : momentum <= TIER_SHIFT.down ? -1 : 0;
  const index = Math.min(TIERS.length - 1, Math.max(0, TIERS.indexOf(tier) + steps));
  return TIERS[index];
}

function inUnsureBand(p: number): boolean {
  return p > UNSURE_BAND.low && p < UNSURE_BAND.high;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whether a saved answer set has every question of the deal set. */
function isComplete(answers: Record<string, SavedAnswer>): boolean {
  return DEAL_SET.every(id => answers[id]) && !!answers.buyer_response?.probabilities;
}

/** The momentum terms that come from the reading of the reply; needs a complete answer set. */
function buyerTerms(answers: Record<string, SavedAnswer>, reader: Reader = 'laya'): GradeReason[] {
  const br = answers.buyer_response?.probabilities ?? {};
  const value = (id: string) => answers[id]?.noul ?? 0;
  const signal = (id: string) => {
    const cutoff = DEAL_CUTOFFS[id]?.cutoff;
    return cutoff !== undefined && value(id) >= cutoff;
  };
  const w = GRADE_WEIGHTS;
  const weighted = (label: string, weight: number, p: number): GradeReason =>
    ({ label: `${label} (P ${round2(p)})`, effect: weight * p, group: 'buyer', strength: round2(p) });
  // Laya: a yes/no flag past the tuned cut-off. LFM3: weighed by its probability.
  const flag = (id: string, weight: number): GradeReason[] =>
    (reader === 'lfm3' ? [weighted(LABELS[id], weight, value(id))]
      : signal(id) ? [{ label: LABELS[id], effect: weight, group: 'buyer' }] : []);
  return [
    weighted('asked for a next step', w.requestedNextStep, br.requested_next_step ?? 0),
    weighted('declined', w.declined, br.declined ?? 0),
    weighted('asked to come back later', w.deferred, br.deferred ?? 0),
    ...flag('trial_reported', w.trialReported),
    ...flag('trial_positive', w.trialPositive),
    weighted('trial went badly', w.trialNegative, value('trial_negative')),
    ...flag('concern_price', w.concernPrice),
    ...flag('concern_technical', w.concernTechnical),
    weighted('delivery concern', w.concernDelivery, value('concern_delivery')),
    weighted('timing concern', w.concernTiming, value('concern_timing')),
    weighted('committed to a next action', w.nextStepCommitment, value('next_step_commitment')),
  ];
}

/**
 * The part of momentum that comes from the reply alone (no order size, no chases), or
 * null when the answer set is incomplete. Comparable across replies on the same deal.
 */
export function replyMomentum(answers: Record<string, SavedAnswer> | null | undefined, reader: Reader = 'laya'): number | null {
  if (!answers || !isComplete(answers)) return null;
  return round2(buyerTerms(answers, reader).reduce((sum, t) => sum + t.effect, 0));
}

/**
 * The order size the grade uses: the confirmed figure, else what the reply states, else
 * the monthly volume from the call checklist.
 */
export function orderKg(deal: Pick<Deal, 'stated_order_kg' | 'buyer_reply' | 'call_checklist'>): number | null {
  return deal.stated_order_kg ?? kilogramsStated(deal.buyer_reply) ?? deal.call_checklist?.monthly_volume_kg ?? null;
}

export function gradeDeal({ deal, judgment, chasesSinceReply }: GradeInput): DealGrade {
  const baseTier = scoreToTier(calculateLeadScore(deal));
  const quantity = quantityTier(orderKg(deal));
  const result = (status: GradeStatus, review: string[], extra: Partial<DealGrade> = {}): DealGrade => ({
    status, baseTier, tier: baseTier, suggestedTier: null, momentum: null, reasons: [], review, quantity, ...extra,
  });

  // 1. Deterministic gates
  if (deal.stage === 'closed_won' || deal.stage === 'closed_lost' ||
      deal.workflow_action === 'parked' || deal.workflow_action === 'success') {
    return result('not_graded', ['closed or parked']);
  }
  const reply = deal.buyer_reply?.trim();
  if (!reply) return result('not_graded', ['no verbatim buyer reply recorded']);

  // 2a. Routing that needs no judgment. Laya never reads Thai; only LFM3's own reading
  // of this exact reply can grade it.
  const thai = hasThaiScript(reply);
  // A lone reading (replyOnly) is always LFM3's.
  const reader: Reader = judgment?.reader ?? (judgment?.replyOnly ? 'lfm3' : 'laya');
  if (thai) {
    if (reader !== 'lfm3' || !judgment?.fresh) return result('needs_review', ['Thai reply — LFM3 has not read it yet; review it yourself']);
    if (judgment.status === 'not_scored') {
      return result('needs_review', [`Thai reply — LFM3 refused to read it (${judgment.not_scored_code ?? 'unknown reason'})`]);
    }
  }
  // An English reply needs Laya's full answer set; LFM3's reading alone is not a judgment.
  if (!judgment || (!thai && judgment.replyOnly)) return result('not_graded', ['not judged yet']);
  if (!judgment.fresh) return result('not_graded', ['judged on an older reply; not judged for the current one']);
  if (judgment.status === 'not_scored') {
    return result('needs_review', [`Laya refused to score (${judgment.not_scored_code ?? 'unknown reason'})`]);
  }

  const answers = judgment.answers ?? {};
  // The questions this reading answers: the whole deal set, or LFM3's reply type alone.
  const replyTypeOnly = thai && !!judgment.replyOnly;
  const asked = replyTypeOnly ? ['buyer_response'] : DEAL_SET;
  const missing = asked.filter(id => !answers[id]);
  const br = answers.buyer_response?.probabilities;
  if (missing.length > 0 || !br) return result('needs_review', [`incomplete judgment: missing ${missing.join(', ') || 'buyer_response'}`]);
  const value = (id: string) => answers[id]?.noul ?? 0;

  // 2b. Unsure answers → review
  const review: string[] = [];
  const pRequest = br.requested_next_step ?? 0;
  const pDeclined = br.declined ?? 0;
  if (inUnsureBand(pRequest)) review.push(`unclear whether the buyer asked for a next step (${round2(pRequest)})`);
  if (inUnsureBand(pDeclined)) review.push(`unclear whether the buyer declined (${round2(pDeclined)})`);
  for (const [id, entry] of Object.entries(DEAL_CUTOFFS)) {
    if (!asked.includes(id) || entry.tier !== 'signal' || entry.cutoff === undefined) continue;
    if (reader === 'lfm3') {
      if (inUnsureBand(value(id))) review.push(`unclear: ${LABELS[id] ?? id} (${round2(value(id))})`);
    } else if (Math.abs(value(id) - entry.cutoff) < NEAR_CUTOFF) {
      review.push(`unclear: ${LABELS[id] ?? id} (${round2(value(id))} vs cut-off ${entry.cutoff})`);
    }
  }

  // 3. Momentum
  const w = GRADE_WEIGHTS;
  const chases = Math.min(Math.max(chasesSinceReply, 0), w.maxChases);
  const terms: GradeReason[] = [
    ...buyerTerms(answers, reader),
    ...(quantity !== 'none' ? [{ label: `order size: ${quantity}`, effect: w.quantity[quantity], group: 'order' as const }] : []),
    ...(chases > 0 ? [{ label: `${chases} unanswered chase${chases === 1 ? '' : 's'} since the last reply`, effect: w.perChaseSinceReply * chases, group: 'followup' as const }] : []),
  ];
  const momentum = round2(terms.reduce((sum, t) => sum + t.effect, 0));
  const reasons = terms
    .filter(t => Math.abs(t.effect) >= 0.01)
    .map(t => ({ ...t, effect: round2(t.effect) }))
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  // Display-only answers: shown, never counted.
  for (const id of asked.filter(id => DEAL_CUTOFFS[id].tier === 'display')) {
    reasons.push({ label: `${id} (display only, P ${round2(value(id))})`, effect: 0, group: 'buyer', strength: round2(value(id)) });
  }
  if (replyTypeOnly) reasons.push({ label: THAI_READ_NOTE, effect: 0, group: 'buyer' });

  // 4. Tier shift — only applied when Laya was sure enough
  const suggestedTier = shiftTier(baseTier, momentum);
  const pRequestedNextStep = round2(pRequest);
  if (review.length > 0) return result('needs_review', review, { momentum, reasons, suggestedTier, pRequestedNextStep });
  return result('graded', [], { tier: suggestedTier, suggestedTier, momentum, reasons, pRequestedNextStep });
}
