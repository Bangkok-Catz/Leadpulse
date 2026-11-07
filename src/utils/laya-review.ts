// ─── Deals Laya routed to Pat ───
// Pure: given deals, their saved judgments and the current input hash of each reply,
// grade every open deal that has a verbatim reply and keep the ones gradeDeal sends to
// review. The deal panel and the This week list share toSavedJudgment, so they agree.

import type { Deal } from '@/types/crm';
import type { LayaJudgmentRow } from '@/lib/crm';
import { gradeDeal, type DealGrade, type SavedJudgment } from './grade';
import { REPLY_ONLY_SET } from './buyer-reading';
import { chasesSinceLastReply, type DatedChaseCountableMeeting } from './interaction-event';
import type { LeadTier } from './lead-scoring';
import { historyByDeal, withTrend } from './laya-trend';
import { decisionFor, withDecision } from './laya-decisions';
import type { ReviewDecisionRow } from '@/lib/crm';

/** A saved row as gradeDeal reads it; fresh only when it was made for the current reply. */
export function toSavedJudgment(row: LayaJudgmentRow | null | undefined, currentSha: string | null): SavedJudgment | null {
  if (!row) return null;
  return {
    status: row.status,
    not_scored_code: row.not_scored_code,
    answers: row.answers,
    fresh: !!currentSha && row.input_sha256 === currentSha,
    replyOnly: row.question_set === REPLY_ONLY_SET,
  };
}

export interface LayaReviewItem {
  deal: Deal;
  grade: DealGrade;
}

const TIER_ORDER: LeadTier[] = ['S', 'A', 'B', 'C', 'D'];

export interface LayaGradeInput {
  deals: Deal[];
  meetings: DatedChaseCountableMeeting[];
  judgments: LayaJudgmentRow[];
  /** dealId -> dealInputSha256(deal) for deals with a verbatim reply */
  currentShas: Map<string, string | null>;
  /** scored rows of every reply, newest first; when given, grades carry a trend */
  history?: LayaJudgmentRow[];
  /** Pat's review decisions, newest first; a decided deal leaves the review list */
  decisions?: ReviewDecisionRow[];
}

/** gradeDeal for every deal with a verbatim reply; deals without one are absent. */
export function gradeDealsWithReplies(input: LayaGradeInput): Map<string, DealGrade> {
  const byDeal = new Map(input.judgments.map(row => [row.deal_id, row]));
  const grades = new Map<string, DealGrade>();
  const history = historyByDeal(input.history ?? []);
  for (const deal of input.deals) {
    if (!deal.buyer_reply?.trim()) continue;
    const row = byDeal.get(deal.id);
    const currentSha = input.currentShas.get(deal.id) ?? null;
    const grade = gradeDeal({
      deal,
      judgment: toSavedJudgment(row, currentSha),
      chasesSinceReply: chasesSinceLastReply(input.meetings, deal.id),
    });
    const decided = withDecision(grade, decisionFor(input.decisions ?? [], deal.id, currentSha));
    grades.set(deal.id, withTrend(decided, row, history.get(deal.id) ?? [], currentSha));
  }
  return grades;
}

/** The deals Laya routed to Pat, hottest CRM tier first, then by client name. */
export function buildLayaReviewList(input: LayaGradeInput): LayaReviewItem[] {
  const grades = gradeDealsWithReplies(input);
  const items: LayaReviewItem[] = input.deals
    .filter(deal => grades.get(deal.id)?.status === 'needs_review')
    .map(deal => ({ deal, grade: grades.get(deal.id)! }));
  return items.sort((a, b) =>
    TIER_ORDER.indexOf(a.grade.baseTier) - TIER_ORDER.indexOf(b.grade.baseTier) ||
    (a.deal.client ?? '').localeCompare(b.deal.client ?? ''));
}
