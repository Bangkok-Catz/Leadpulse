// ─── Is a saved judgment about the deal's CURRENT reply? (browser-safe) ───
// The worker stored sha256(JSON.stringify({ state, questions })) as input_sha256.
// Rebuilding the same request from the current CRM row and hashing it with Web
// Crypto says whether the saved answers still describe what the buyer wrote.

import { dealScoreRequest, dealSetRequest, type RequestDeal } from './laya-deal-request.ts';

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The input hash the worker would store for this deal now, or null when there is nothing to judge. */
export async function dealInputSha256(deal: RequestDeal): Promise<string | null> {
  const request = dealScoreRequest(deal);
  return request ? sha256Hex(request.body) : null;
}

/**
 * The deal-set input hash of one scored state: what dealInputSha256 gives for a deal whose
 * reply builds that state. LFM3's reading of a Thai reply (which Laya never judges) carries
 * it, so freshness and Pat's decisions match the reading like a Laya row.
 */
export function stateInputSha256(state: string): Promise<string> {
  return sha256Hex(dealSetRequest(state).body);
}
