// ─── LFM3 buyer-reply reader: pure parts (no network, no model) ───
// Liquid AI's LFM3-1.7B (4-bit GGUF, run by llama.cpp on the Mac) reads a deal's
// verbatim buyer reply and answers the frozen "buyer" set: the one buyer_response
// Choice. On Laya's own holdout its probabilities rank replies far better — AUC 0.97 /
// 0.99 / 1.00 vs 0.87 / 0.89 / 0.87 for requested_next_step / declined / deferred, the
// three that grade.ts weighs — though its single pick is no better (13/26 vs 11/26): it
// calls "no commitment yet" replies deferred (scripts/eval_results/2026-11-07-lfm3-buyer-response.md).
// Laya keeps the rest of the "terminal" set; the app swaps this reading in (buyer-reading.ts).
//
// Since 2026-11-07 it can answer the whole "terminal" set too: the ten yes/no questions
// (trial, concerns, info request, commitment) in Laya's own wording, one prompt each. On
// Laya's holdout it ranks better on seven, ties on delivery and is worse on commitment
// (0.77 vs 0.83) and timing (0.74 vs 0.86); right answers 202/218 English and 70/80 Thai,
// against Laya's 189/218 and 48/80 (scripts/eval_results/2026-11-07-lfm3-deal-questions.md).
// The worker uses it for deals by default; Laya keeps the prospect fit set.
//
// The answer has Laya's shape — a choice with a probability per option — so grade.ts
// needs no change. Each option's probability is the model's probability of writing that
// label's exact tokens after the JSON prefix, renormalised over the five labels. When
// the five labels together get too little of the model's probability, nothing is saved.
//
// scripts/lfm3-buyer-reader.ts does the I/O; this module is the logic it shares with tests.

import { LAYA_BUYER_FROZEN_QUESTIONS } from './laya-buyer-response.ts';

/** The question set this reader answers (laya-questions.json "buyer"). */
export const BUYER_QUESTION_SET = 'buyer';

/** The downloaded model this reader runs (see download-metadata/verified-download.json). */
export const LFM3_MODEL = {
  repository: 'LiquidAI/LFM3-1.7B-GGUF',
  source_revision: 'cd0c74c575b5c416f3011b5b4c298077f26ca8c2',
  /** llama.cpp offloads every layer to the GPU with Metal; the CPU only drives it */
  engine: 'cpu_gpu',
} as const;

/** Below this share of probability on the five labels, the model meant something else: skip. */
export const MIN_LABEL_MASS = 0.5;

const QUESTION = LAYA_BUYER_FROZEN_QUESTIONS.buyer_response as unknown as {
  criteria: Record<string, string>;
};
export const BUYER_LABELS = Object.keys(QUESTION.criteria);

// The exact wording evaluated on 2026-11-07. Changing it means re-running the dev set.
export const BUYER_SYSTEM_PROMPT =
  "You read a buyer's latest reply to a dairy-free butter supplier (the buyer's own words, or our note of " +
  'the reply) and pick the one label that best describes it. Labels:\n' +
  Object.entries(QUESTION.criteria).map(([k, v]) => `- ${k}: ${v}`).join('\n') +
  "\nAlso copy any follow-up time the buyer states (for example 'next week', 'after Songkran'), " +
  'word for word, or null if none. Answer in JSON only.';

/** The answer is read where the label starts: the model is handed this much of its JSON. */
export const ANSWER_PREFIX = '{"label": "';

export function buyerMessages(state: string) {
  return [
    { role: 'system', content: BUYER_SYSTEM_PROMPT },
    { role: 'user', content: state },
  ];
}

// The same explicit-language gate as Laya's server (scripts/laya_input.py): a reply that
// says not to contact us is never judged, only recorded as a refusal.
const OPT_OUT_PATTERNS = [
  /\b(?:do not|don't|dont|never)\s+(?:contact|call|email|message|reach out(?: to)?)\b/i,
  /\b(?:asked|requested|requests?|wants?|prefers?|said|told us)\s+(?:us\s+)?(?:for\s+)?(?:no\s+(?:further\s+)?(?:contact|outreach)|not\s+to\s+(?:be\s+)?(?:contact(?:ed)?|call|email|message))\b/i,
  /\b(?:asked|requested|requests?|wants?|prefers?|said|told us)\s+(?:us\s+)?(?:to\s+)?stop\s+(?:calling|contacting|emailing|messaging)\b/i,
  /\b(?:stop|cease)\s+(?:all\s+)?(?:contacting|contact|outreach|messaging|emails?)\b/i,
  /\b(?:unsubscribe|unsubscribed|opted[\s-]+out)\b/i,
  /(?:ไม่ต้อง|อย่า|ห้าม|งด|ขอไม่ให้|ไม่ต้องการ(?:ให้)?)\s*(?:ติดต่อ|ทัก|โทร)/,
];

export function hasExplicitContactOptOut(state: string): boolean {
  return OPT_OUT_PATTERNS.some(pattern => pattern.test(state));
}

/**
 * A label is not followed further once its probability so far is below this: it counts
 * as 0, which moves the other labels by under 0.0002 — far inside the validator's 0.002.
 * llama.cpp cannot reuse a hybrid model's cache, so every query re-reads the prompt
 * (~0.5 s on the M1); a sure answer needs one or two queries instead of nine.
 */
export const PRUNE_BELOW = 1e-4;

/**
 * The next token prefix whose next-token probabilities are still needed, or null when
 * every label is scored or pruned. Ask the model for it, add it to `nextLogprobs`, repeat.
 */
export function nextPrefixToQuery(
  labelTokens: Record<string, number[]>,
  /** prefix (token ids joined by ",") -> token id -> log probability */
  nextLogprobs: Map<string, Map<number, number>>,
): number[] | null {
  for (const tokens of Object.values(labelTokens)) {
    let p = 1;
    for (let i = 0; i < tokens.length && p >= PRUNE_BELOW; i += 1) {
      const probs = nextLogprobs.get(tokens.slice(0, i).join(','));
      if (!probs) return tokens.slice(0, i);
      const logprob = probs.get(tokens[i]);
      p *= logprob === undefined ? 0 : Math.exp(logprob);
    }
  }
  return null;
}

/**
 * Each label's probability: the product of its tokens' probabilities, each read from the
 * next-token probabilities after the tokens before it. A token missing from the returned
 * top list counts as probability 0 (it was below every listed token), and so does a
 * pruned label (its later prefixes were never asked).
 */
export function labelProbabilities(
  labelTokens: Record<string, number[]>,
  /** prefix (token ids joined by ",") -> token id -> log probability */
  nextLogprobs: Map<string, Map<number, number>>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [label, tokens] of Object.entries(labelTokens)) {
    let p = tokens.length > 0 ? 1 : 0;
    for (let i = 0; i < tokens.length && p > 0; i += 1) {
      const logprob = nextLogprobs.get(tokens.slice(0, i).join(','))?.get(tokens[i]);
      p *= logprob === undefined ? 0 : Math.exp(logprob);
    }
    result[label] = p;
  }
  return result;
}

export interface BuyerChoice {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

/**
 * Laya's Choice shape from raw label probabilities, or null when the labels together got
 * less than MIN_LABEL_MASS. Confidence is Laya's: 1 − entropy / log(number of options).
 */
export function choiceFromLabelProbabilities(raw: Record<string, number>): { answer: BuyerChoice; mass: number } | null {
  const labels = BUYER_LABELS;
  const mass = labels.reduce((sum, label) => sum + (raw[label] ?? 0), 0);
  if (!(mass >= MIN_LABEL_MASS)) return null;
  const rounded: Record<string, number> = {};
  for (const label of labels) rounded[label] = Math.round(((raw[label] ?? 0) / mass) * 1e6) / 1e6;
  const choice = labels.reduce((best, label) => (rounded[label] > rounded[best] ? label : best), labels[0]);
  // Rounding can leave the sum a millionth off; the chosen label absorbs it.
  const residual = 1 - labels.reduce((sum, label) => sum + rounded[label], 0);
  rounded[choice] = Math.round((rounded[choice] + residual) * 1e6) / 1e6;
  const entropy = -labels.reduce((sum, label) => (rounded[label] > 0 ? sum + rounded[label] * Math.log(rounded[label]) : sum), 0);
  const confidence = Math.round(Math.max(0, Math.min(1, 1 - entropy / Math.log(labels.length))) * 1e4) / 1e4;
  return { answer: { type: 'choice', choice, confidence, probabilities: rounded }, mass };
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
  confidence: number;
}

// The yes/no wording evaluated on 2026-11-07, one question per prompt. Changing it means
// re-running scripts/evaluate-lfm3-deal.ts on the audit (dev) set first.
export const NOUL_SYSTEM_PROMPT =
  "You read a buyer's latest reply to a dairy-free butter supplier and answer one yes-or-no question " +
  'about what the buyer says. Answer in JSON only.';

/** The yes/no answer is read where it starts. */
export const NOUL_ANSWER_PREFIX = '{"answer": "';

/** The model spells its answer several ways; every spelling counts toward its side. */
export const YES_SPELLINGS = ['yes', 'Yes', 'YES', 'true', 'True'];
export const NO_SPELLINGS = ['no', 'No', 'NO', 'false', 'False'];

/** A Noul question as laya-questions.json words it. */
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

export function noulMessages(state: string, question: NoulQuestion) {
  let user = `${state}\n\nQuestion: ${question.instructions}`;
  if (question.criteria) user += `\nAnswer yes if ${question.criteria.true}.\nAnswer no if ${question.criteria.false}.`;
  return [
    { role: 'system', content: NOUL_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/**
 * Laya's Noul shape from raw spelling probabilities: P(yes) against P(no), every spelling
 * counted. No floor, as evaluated: when neither side got any probability the answer is
 * 0.5, which grade.ts reads as unsure. Confidence is Laya's: max(noul, 1 − noul).
 */
export function noulFromLabelProbabilities(raw: Record<string, number>): { answer: NoulAnswer; mass: number } {
  const yes = YES_SPELLINGS.reduce((sum, label) => sum + (raw[label] ?? 0), 0);
  const no = NO_SPELLINGS.reduce((sum, label) => sum + (raw[label] ?? 0), 0);
  const mass = yes + no;
  const noul = Math.round((mass > 0 ? yes / mass : 0.5) * 1e6) / 1e6;
  return { answer: { type: 'noul', noul, confidence: Math.max(noul, Math.round((1 - noul) * 1e6) / 1e6) }, mass };
}

export interface ReaderIdentity {
  repository: string;
  source_revision: string;
  package_sha256: string;
  engine: string;
}

/**
 * The reading as a Laya /score response, so the worker's one validator and row builder
 * (parseLayaScore, judgmentRowFromResponse) check and save it exactly like Laya's.
 */
export function buyerScoreResponse(
  sent: { state: string; questions: Record<string, unknown> },
  result: { answer: BuyerChoice; inputTokens: number } | { notScored: 'contact_opt_out' | 'input_too_long' },
  model: ReaderIdentity,
  scoredAt: Date = new Date(),
): { status: number; payload: unknown } {
  if ('notScored' in result) return readerScoreResponse(sent, result, model, scoredAt);
  return readerScoreResponse(sent, { answers: { buyer_response: result.answer }, inputTokens: result.inputTokens }, model, scoredAt);
}

/** Any set of answers (the whole deal set, or buyer_response alone) as a Laya /score response. */
export function readerScoreResponse(
  sent: { state: string; questions: Record<string, unknown> },
  result: { answers: Record<string, BuyerChoice | NoulAnswer>; inputTokens: number } | { notScored: 'contact_opt_out' | 'input_too_long' },
  model: ReaderIdentity,
  scoredAt: Date = new Date(),
): { status: number; payload: unknown } {
  if ('notScored' in result) return { status: 422, payload: { status: 'not_scored', code: result.notScored } };
  return {
    status: 200,
    payload: {
      answers: result.answers,
      usage: { input_tokens: result.inputTokens, output_tokens: 0 },
      trace: { scored_input: sent, model, scored_at: scoredAt.toISOString() },
    },
  };
}
