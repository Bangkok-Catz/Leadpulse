// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLayaScore } from './laya-answers';
import { LAYA_BUYER_FROZEN_QUESTIONS } from './laya-buyer-response';
import { buildBuyerScoreRequest, buildLfm3DealRequest, buildScoreRequest, buyerSkipReason, judgmentRowFromResponse, type WorkerDeal } from './laya-worker';
import {
  BUYER_LABELS, BUYER_QUESTION_SET, LFM3_MODEL, MIN_LABEL_MASS, NOUL_SYSTEM_PROMPT, NO_SPELLINGS, YES_SPELLINGS,
  buyerScoreResponse, choiceFromLabelProbabilities, PRUNE_BELOW, hasExplicitContactOptOut, labelProbabilities,
  nextPrefixToQuery, noulFromLabelProbabilities, noulMessages, readerScoreResponse,
} from './lfm3-buyer';

const deal: WorkerDeal = {
  id: '11111111-1111-1111-1111-111111111111',
  product: 'Butter',
  buyer_reply: 'Please send us a quotation for 20 kg.',
  last_outcome: null,
  stage: 'proposal',
  workflow_action: 'sample',
};
const identity = { ...LFM3_MODEL, package_sha256: '3793e1e6e2266919d6e015287221b41100175a98eddaba92e111aed3b05c93c4' };

// The labels' real LFM3 tokens after the answer prefix (checked against llama-server on 2026-11-07).
const LABEL_TOKENS: Record<string, number[]> = {
  unclear: [384, 14143],
  no_commitment: [2243, 71, 55687, 456],
  declined: [44861, 1419],
  deferred: [634, 25244],
  requested_next_step: [66367, 94603, 95632],
};

describe('the frozen buyer set', () => {
  it('asks only buyer_response, with the five labels in the frozen order', () => {
    expect(Object.keys(LAYA_BUYER_FROZEN_QUESTIONS)).toEqual(['buyer_response']);
    expect(BUYER_LABELS).toEqual(['unclear', 'no_commitment', 'declined', 'deferred', 'requested_next_step']);
  });
});

const lp = (entries: Array<[number, number]>) => new Map(entries.map(([id, p]) => [id, Math.log(p)]));

/** Run the query loop against a fake model that answers every prefix with `answer(prefix)`. */
function queried(answer: (prefix: string) => Array<[number, number]>) {
  const next = new Map<string, Map<number, number>>();
  const asked: string[] = [];
  for (let prefix = nextPrefixToQuery(LABEL_TOKENS, next); prefix; prefix = nextPrefixToQuery(LABEL_TOKENS, next)) {
    const key = prefix.join(',');
    expect(asked).not.toContain(key); // never asks the same prefix twice
    asked.push(key);
    next.set(key, lp(answer(key)));
  }
  return { asked, next };
}

describe('nextPrefixToQuery', () => {
  it('starts with the empty prefix and never asks past a label\'s last token', () => {
    expect(nextPrefixToQuery(LABEL_TOKENS, new Map())).toEqual([]);
    // every label likely: the whole tree but the leaves
    const { asked } = queried(() => [[384, 0.2], [2243, 0.2], [44861, 0.2], [634, 0.2], [66367, 0.2],
      [14143, 1], [71, 1], [55687, 1], [456, 1], [1419, 1], [25244, 1], [94603, 1], [95632, 1]]);
    expect(asked).toHaveLength(1 + 1 + 3 + 1 + 1 + 2);
    expect(asked).toContain('2243,71,55687');
    expect(asked).not.toContain('2243,71,55687,456');
  });

  it('stops following a label once it is below PRUNE_BELOW', () => {
    // a sure decline: only "decl" is worth following
    const { asked, next } = queried(key => (key === '' ? [[44861, 0.99], [634, PRUNE_BELOW / 2]] : [[1419, 1]]));
    expect(asked).toEqual(['', '44861']);
    const p = labelProbabilities(LABEL_TOKENS, next);
    expect(p.declined).toBeCloseTo(0.99);
    expect(p.deferred).toBe(0);
  });
});

describe('labelProbabilities', () => {
  it('multiplies each token of a label, read after the tokens before it', () => {
    const next = new Map<string, Map<number, number>>([
      ['', lp([[44861, 0.6], [634, 0.3], [384, 0.05]])],
      ['44861', lp([[1419, 1]])],
      ['634', lp([[25244, 0.5]])], // half of "de…" continues as "ferred"
      ['384', lp([[14143, 1]])],
    ]);
    const p = labelProbabilities(LABEL_TOKENS, next);
    expect(p.declined).toBeCloseTo(0.6);
    expect(p.deferred).toBeCloseTo(0.15);
    expect(p.unclear).toBeCloseTo(0.05);
    expect(p.no_commitment).toBe(0); // its first token was not in the returned top list
    expect(p.requested_next_step).toBe(0);
  });
});

describe('choiceFromLabelProbabilities', () => {
  it('renormalises over the five labels into an exact distribution with Laya-style confidence', () => {
    const read = choiceFromLabelProbabilities({ unclear: 0.01, no_commitment: 0.02, declined: 0.03, deferred: 0.04, requested_next_step: 0.8 })!;
    expect(read.mass).toBeCloseTo(0.9);
    expect(read.answer.choice).toBe('requested_next_step');
    const sum = Object.values(read.answer.probabilities).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    expect(read.answer.probabilities.requested_next_step).toBeCloseTo(0.8 / 0.9, 5);
    expect(read.answer.confidence).toBeGreaterThan(0);
    expect(read.answer.confidence).toBeLessThan(1);
  });

  it('gives confidence 1 to a certain answer and 0 to an even spread', () => {
    expect(choiceFromLabelProbabilities({ declined: 1 })!.answer.confidence).toBe(1);
    const even = Object.fromEntries(BUYER_LABELS.map(l => [l, 0.2]));
    expect(choiceFromLabelProbabilities(even)!.answer.confidence).toBe(0);
  });

  it('saves nothing when the labels together got too little probability', () => {
    expect(choiceFromLabelProbabilities({ declined: MIN_LABEL_MASS - 0.01 })).toBeNull();
    expect(choiceFromLabelProbabilities({})).toBeNull();
  });
});

describe('hasExplicitContactOptOut', () => {
  it('matches the safety fixtures Laya refuses, in English and Thai', () => {
    const fixtures = JSON.parse(readFileSync(join(__dirname, '../../scripts/fixtures/laya_buyer_response.dev.verbatim.json'), 'utf8'));
    const optOuts = fixtures.safety.filter((c: { expected_handling: string }) => c.expected_handling === 'not_scored_opt_out');
    expect(optOuts.length).toBeGreaterThan(0);
    for (const c of optOuts) expect(hasExplicitContactOptOut(c.buyer_reply ?? c.outcome), c.id).toBe(true);
  });

  it('lets ordinary replies through', () => {
    for (const reply of fixturesScoreable()) expect(hasExplicitContactOptOut(reply), reply).toBe(false);
  });
});

function fixturesScoreable(): string[] {
  const fixtures = JSON.parse(readFileSync(join(__dirname, '../../scripts/fixtures/laya_buyer_response.dev.verbatim.json'), 'utf8'));
  return fixtures.scoreable.map((c: { buyer_reply?: string }) => c.buyer_reply).filter(Boolean);
}

describe('the buyer request and its saved row', () => {
  it('reads Thai replies too, but keeps the other gates', () => {
    expect(buyerSkipReason({ ...deal, buyer_reply: 'ขอใบเสนอราคาครับ' })).toBeNull();
    expect(buyerSkipReason({ ...deal, stage: 'closed_won' })).toBe('closed_or_parked');
    expect(buyerSkipReason({ ...deal, buyer_reply: null })).toBe('no_verbatim_reply');
  });

  it('asks the buyer set about the same state Laya scores', () => {
    const request = buildBuyerScoreRequest(deal)!;
    expect(request.questionSet).toBe(BUYER_QUESTION_SET);
    expect(Object.keys(request.sent.questions)).toEqual(['buyer_response']);
    expect(request.sent.state).toBe('We supply Butter to this account. The buyer\'s latest reply: "Please send us a quotation for 20 kg."');
  });

  it('passes the same validator as Laya and saves a "buyer" row', () => {
    const request = buildBuyerScoreRequest(deal)!;
    const read = choiceFromLabelProbabilities({ unclear: 0.02, no_commitment: 0.03, declined: 0.01, deferred: 0.04, requested_next_step: 0.85 })!;
    const response = buyerScoreResponse(request.sent, { answer: read.answer, inputTokens: 210 }, identity, new Date('2026-11-07T10:00:00Z'));
    expect(parseLayaScore(response.payload, request.sent)).not.toBeNull();
    const row = judgmentRowFromResponse(request, response, identity)!;
    expect(row).toMatchObject({
      deal_id: deal.id, question_set: 'buyer', status: 'scored', engine: 'cpu_gpu',
      model_repository: 'LiquidAI/LFM3-1.7B-GGUF', model_package_sha256: identity.package_sha256,
      scored_state: request.sent.state, usage_input_tokens: 210, scored_at: '2026-11-07T10:00:00.000Z',
    });
    expect(row.company_id).toBeUndefined();
    expect((row.answers as Record<string, { choice: string }>).buyer_response.choice).toBe('requested_next_step');
  });

  it('records an opt-out as a refusal with no answers', () => {
    const request = buildBuyerScoreRequest({ ...deal, buyer_reply: 'Please do not contact us again.' })!;
    const row = judgmentRowFromResponse(request, buyerScoreResponse(request.sent, { notScored: 'contact_opt_out' }, identity), identity)!;
    expect(row).toMatchObject({ question_set: 'buyer', status: 'not_scored', not_scored_code: 'contact_opt_out', answers: null });
  });
});

describe('the ten yes/no deal questions', () => {
  const QUESTIONS = JSON.parse(readFileSync(join(__dirname, 'laya-questions.json'), 'utf8')).questions;

  it('keeps the evaluated wording: one question per prompt, criteria spelled out', () => {
    expect(NOUL_SYSTEM_PROMPT).toBe("You read a buyer's latest reply to a dairy-free butter supplier and answer one yes-or-no question about what the buyer says. Answer in JSON only.");
    const [system, user] = noulMessages('STATE', QUESTIONS.trial_positive);
    expect(system).toEqual({ role: 'system', content: NOUL_SYSTEM_PROMPT });
    expect(user.content).toBe(
      'STATE\n\nQuestion: Does the buyer say our sample worked well in their test?\n' +
      'Answer yes if the buyer reports a good test result.\nAnswer no if the buyer reports no good test result.');
    expect(noulMessages('STATE', QUESTIONS.trial_negative)[1].content).toBe('STATE\n\nQuestion: Does the buyer say our sample did not work well in their test?');
  });

  it('counts every spelling of yes against every spelling of no', () => {
    // what the model wrote after {"answer": " on a price question: false 0.65, no 0.24, true 0.04, No 0.04, yes 0.03
    const { answer, mass } = noulFromLabelProbabilities({ false: 0.653, no: 0.235, true: 0.041, No: 0.036, yes: 0.028 });
    expect(mass).toBeCloseTo(0.993, 3);
    expect(answer.noul).toBeCloseTo(0.069 / 0.993, 5);
    expect(answer.confidence).toBeCloseTo(1 - answer.noul, 5);
    expect(YES_SPELLINGS).toEqual(['yes', 'Yes', 'YES', 'true', 'True']);
    expect(NO_SPELLINGS).toEqual(['no', 'No', 'NO', 'false', 'False']);
  });

  it('reads no probability on either side as unsure, 0.5, as evaluated', () => {
    expect(noulFromLabelProbabilities({}).answer).toEqual({ type: 'noul', noul: 0.5, confidence: 0.5 });
  });
});

describe("LFM3's whole deal-set reading", () => {
  const terminalAnswers = (request: NonNullable<ReturnType<typeof buildLfm3DealRequest>>) => {
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(request.sent.questions) as Array<[string, { type: string }]>) {
      answers[id] = q.type === 'choice'
        ? choiceFromLabelProbabilities({ requested_next_step: 0.9, deferred: 0.05, unclear: 0.03, declined: 0.01, no_commitment: 0.01 })!.answer
        : noulFromLabelProbabilities({ yes: 0.1, no: 0.9 }).answer;
    }
    return answers as Record<string, never>;
  };

  it('asks the same request Laya does, Thai replies included', () => {
    const english = buildLfm3DealRequest(deal)!;
    expect(english.body).toBe(buildScoreRequest(deal)!.body);
    expect(english.inputSha256).toBe(buildScoreRequest(deal)!.inputSha256);
    expect(english.questionSet).toBeUndefined();
    const thai = { ...deal, buyer_reply: 'ขอใบเสนอราคาครับ' };
    expect(buildScoreRequest(thai)).toBeNull();
    expect(Object.keys(buildLfm3DealRequest(thai)!.sent.questions)).toHaveLength(11);
    expect(buildLfm3DealRequest({ ...deal, stage: 'closed_lost' })).toBeNull();
  });

  it('passes the same validator as Laya and saves a "terminal" row named for LFM3', () => {
    const request = buildLfm3DealRequest(deal)!;
    const response = readerScoreResponse(request.sent, { answers: terminalAnswers(request), inputTokens: 210 }, identity, new Date('2026-11-07T15:00:00Z'));
    expect(parseLayaScore(response.payload, request.sent)).not.toBeNull();
    const row = judgmentRowFromResponse(request, response, identity)!;
    expect(row).toMatchObject({
      question_set: 'terminal', status: 'scored', model_repository: 'LiquidAI/LFM3-1.7B-GGUF',
      model_package_sha256: identity.package_sha256, engine: 'cpu_gpu', input_sha256: request.inputSha256,
    });
    expect(Object.keys(row.answers!)).toHaveLength(11);
  });

  it('is rejected by the validator when any question is missing', () => {
    const request = buildLfm3DealRequest(deal)!;
    const answers = terminalAnswers(request);
    delete (answers as Record<string, unknown>).concern_timing;
    expect(judgmentRowFromResponse(request, readerScoreResponse(request.sent, { answers, inputTokens: 1 }, identity), identity)).toBeNull();
  });
});
