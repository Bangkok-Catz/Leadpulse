// ─── Laya judgment worker: pure parts (no network, no model) ───
// The script (scripts/laya-judgment-worker.ts) does the I/O; this module decides
// which deals and prospects qualify, builds the exact /score request, hashes it, and
// turns a worker response into a laya_judgments row. Design: docs/laya-judgments-store.md.
//
// The request is built by the SAME builder and question set the app uses, and the
// hash is sha256(JSON.stringify({ state, questions })) — so the app can recompute it
// from the current CRM row and tell a fresh judgment from a stale one.

import { createHash } from 'node:crypto';
import type { Company, Deal } from '../types/crm.ts';
import { parseLayaScore } from './laya-answers.ts';
import { buildLayaProspectFitInput, hasThaiScript } from './laya-buyer-response.ts';
import { buyerScoreRequest, dealScoreRequest } from './laya-deal-request.ts';
import { BUYER_QUESTION_SET } from './lfm3-buyer.ts';

export const DEAL_QUESTION_SET = 'terminal';
/** The prospect-fit set: judges a company, so enrichment can work on likely buyers first. */
export const FIT_QUESTION_SET = 'fit';

export type WorkerDeal = Pick<Deal, 'id' | 'product' | 'buyer_reply' | 'last_outcome' | 'stage' | 'workflow_action'>;

export type SkipReason = 'closed_or_parked' | 'no_verbatim_reply' | 'thai_reply';

export interface ScoreRequest {
  dealId: string;
  companyId?: never;
  /** the deal set this request answers; Laya's "terminal" when absent */
  questionSet?: typeof DEAL_QUESTION_SET | typeof BUYER_QUESTION_SET;
  body: string;
  sent: { state: string; questions: Record<string, unknown> };
  inputSha256: string;
  questionsSha256: string;
}

/** A prospect's fit request. The same builder and frozen questions as the app's lab page. */
export interface FitScoreRequest {
  companyId: string;
  dealId?: never;
  questionSet?: never;
  body: string;
  sent: { state: string; questions: Record<string, unknown> };
  inputSha256: string;
  questionsSha256: string;
}

export type WorkerCompany = Pick<Company, 'id' | 'name' | 'industry' | 'tags' | 'status'>;

export type FitSkipReason = 'not_a_prospect' | 'needs_evidence';

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Why a deal is not sent to Laya, or null when it should be. Deterministic gates only. */
export function skipReason(deal: WorkerDeal): SkipReason | null {
  if (deal.stage === 'closed_won' || deal.stage === 'closed_lost' ||
      deal.workflow_action === 'parked' || deal.workflow_action === 'success') return 'closed_or_parked';
  if (!deal.buyer_reply?.trim()) return 'no_verbatim_reply';
  // Thai routes to Pat in grade.ts; scoring it would only store unreliable answers.
  if (hasThaiScript(deal.buyer_reply)) return 'thai_reply';
  return null;
}

/** The exact /score request for one deal, with its hashes. */
export function buildScoreRequest(deal: WorkerDeal): ScoreRequest | null {
  if (skipReason(deal)) return null;
  const request = dealScoreRequest(deal);
  if (!request) return null;
  const { sent, body } = request;
  return {
    dealId: deal.id,
    body,
    sent,
    inputSha256: sha256(body),
    questionsSha256: sha256(JSON.stringify(sent.questions)),
  };
}

/**
 * Why a deal's reply is not read by the LFM3 buyer reader, or null when it should be.
 * Laya's gates without the Thai one: LFM3 reads Thai (5/5 dev, 5/8 holdout). grade.ts
 * still routes Thai replies to Pat; the saved readings are there for when it stops.
 */
export function buyerSkipReason(deal: WorkerDeal): Exclude<SkipReason, 'thai_reply'> | null {
  const reason = skipReason(deal);
  return reason === 'thai_reply' ? null : reason;
}

/** The exact "buyer" set request for one deal (LFM3's), with its hashes. */
export function buildBuyerScoreRequest(deal: WorkerDeal): ScoreRequest | null {
  if (buyerSkipReason(deal)) return null;
  const request = buyerScoreRequest(deal);
  if (!request) return null;
  const { sent, body } = request;
  return {
    dealId: deal.id,
    questionSet: BUYER_QUESTION_SET,
    body,
    sent,
    inputSha256: sha256(body),
    questionsSha256: sha256(JSON.stringify(sent.questions)),
  };
}

/**
 * The exact deal-set ("terminal") request for LFM3: the same body, hash and question set
 * as Laya's, Thai replies included (LFM3 reads Thai; Laya cannot). One saved row per reply
 * and reader, told apart by model_package_sha256.
 */
export function buildLfm3DealRequest(deal: WorkerDeal): ScoreRequest | null {
  if (buyerSkipReason(deal)) return null;
  const request = dealScoreRequest(deal);
  if (!request) return null;
  const { sent, body } = request;
  return {
    dealId: deal.id,
    body,
    sent,
    inputSha256: sha256(body),
    questionsSha256: sha256(JSON.stringify(sent.questions)),
  };
}

/** Why a company is not judged for fit, or null when it should be. A customer already
 *  buys; a name with no industry and no tags is not evidence of a business type. */
export function fitSkipReason(company: WorkerCompany): FitSkipReason | null {
  if (company.status !== 'prospect') return 'not_a_prospect';
  if (!buildLayaProspectFitInput(company)) return 'needs_evidence';
  return null;
}

/** The exact fit /score request for one prospect, with its hashes. */
export function buildFitScoreRequest(company: WorkerCompany): FitScoreRequest | null {
  if (fitSkipReason(company)) return null;
  const built = buildLayaProspectFitInput(company);
  if (!built) return null;
  const sent = { state: built.state, questions: built.questions as Record<string, unknown> };
  const body = JSON.stringify(sent);
  return {
    companyId: company.id,
    body,
    sent,
    inputSha256: sha256(body),
    questionsSha256: sha256(JSON.stringify(sent.questions)),
  };
}

export interface JudgmentRow {
  /** exactly one subject: a deal for the deal sets, a company for the fit set */
  deal_id?: string;
  company_id?: string;
  question_set: string;
  questions_sha256: string;
  input_sha256: string;
  scored_state: string;
  status: 'scored' | 'not_scored';
  not_scored_code: string | null;
  answers: Record<string, unknown> | null;
  usage_input_tokens: number | null;
  model_repository: string;
  model_revision: string;
  model_package_sha256: string;
  engine: string;
  scored_at: string;
}

export interface ModelIdentity {
  repository: string;
  source_revision: string;
  package_sha256: string;
  engine: string;
}

const NOT_SCORED_CODES = new Set(['contact_opt_out', 'input_too_long']);

/**
 * Turn one /score response into a row, or null when nothing should be saved (a
 * transport error, a busy worker, or a malformed payload — the next pass retries).
 */
export function judgmentRowFromResponse(
  request: ScoreRequest | FitScoreRequest,
  response: { status: number; payload: unknown },
  model: ModelIdentity,
  now: Date = new Date(),
): JudgmentRow | null {
  const subject = request.companyId
    ? { company_id: request.companyId, question_set: FIT_QUESTION_SET }
    : { deal_id: request.dealId as string, question_set: request.questionSet ?? DEAL_QUESTION_SET };
  const base = {
    ...subject,
    questions_sha256: request.questionsSha256,
    input_sha256: request.inputSha256,
    scored_state: request.sent.state,
  };
  const p = response.payload as { status?: unknown; code?: unknown; answers?: unknown; usage?: { input_tokens?: unknown } } | null;

  if (response.status === 422 && p?.status === 'not_scored' && typeof p.code === 'string' && NOT_SCORED_CODES.has(p.code)) {
    return {
      ...base, status: 'not_scored', not_scored_code: p.code, answers: null, usage_input_tokens: null,
      model_repository: model.repository, model_revision: model.source_revision,
      model_package_sha256: model.package_sha256, engine: model.engine, scored_at: now.toISOString(),
    };
  }
  if (response.status !== 200) return null;

  // The shared parser checks every answer and that the trace echoes this exact request.
  const run = parseLayaScore(response.payload, request.sent);
  if (!run) return null;
  const tokens = p?.usage?.input_tokens;
  return {
    ...base,
    status: 'scored',
    not_scored_code: null,
    answers: p!.answers as Record<string, unknown>,
    usage_input_tokens: typeof tokens === 'number' && Number.isInteger(tokens) && tokens > 0 ? tokens : null,
    model_repository: run.trace.model.repository,
    model_revision: run.trace.model.source_revision,
    model_package_sha256: run.trace.model.package_sha256,
    engine: run.trace.model.engine,
    scored_at: run.trace.scored_at,
  };
}
