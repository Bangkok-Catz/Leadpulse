// ─── The exact /score request for a deal — shared by the worker and the app ───
// No crypto and no Node built-ins, so the browser can import it. The worker hashes
// the body with node:crypto (laya-worker.ts); the app hashes the same body with Web
// Crypto (laya-freshness.ts) to tell a fresh saved judgment from a stale one.

import type { Deal } from '../types/crm.ts';
import { buildLayaBuyerResponseInput, LAYA_ALL_FROZEN_QUESTIONS, LAYA_BUYER_FROZEN_QUESTIONS } from './laya-buyer-response.ts';

export type RequestDeal = Pick<Deal, 'product' | 'buyer_reply' | 'last_outcome'>;

export interface DealScoreRequest {
  sent: { state: string; questions: Record<string, unknown> };
  /** JSON.stringify(sent) — the exact bytes POSTed and hashed */
  body: string;
}

/** The deal-set request for a verbatim reply, or null when there is none to judge. */
export function dealScoreRequest(deal: RequestDeal): DealScoreRequest | null {
  const built = buildLayaBuyerResponseInput({ deal });
  if (!built?.verbatim) return null;
  const sent = { state: built.state, questions: LAYA_ALL_FROZEN_QUESTIONS as Record<string, unknown> };
  return { sent, body: JSON.stringify(sent) };
}

/**
 * The "buyer" set request for a verbatim reply: the same state as the deal set, asking
 * only buyer_response. LFM3 answers it (lfm3-buyer.ts); the shared state is how the app
 * knows the two readings are of the same reply.
 */
export function buyerScoreRequest(deal: RequestDeal): DealScoreRequest | null {
  const built = buildLayaBuyerResponseInput({ deal });
  if (!built?.verbatim) return null;
  const sent = { state: built.state, questions: LAYA_BUYER_FROZEN_QUESTIONS as unknown as Record<string, unknown> };
  return { sent, body: JSON.stringify(sent) };
}
