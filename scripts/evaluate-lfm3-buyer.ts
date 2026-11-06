#!/usr/bin/env node
// Evaluate the LFM3 buyer reader exactly as the worker runs it (same request builder, prompt,
// probabilities and validator) on a labelled buyer-reply fixture. Writes nothing to Supabase.
//
//   node --no-warnings scripts/evaluate-lfm3-buyer.ts scripts/fixtures/laya_buyer_response.dev.verbatim.json
//   node --no-warnings scripts/evaluate-lfm3-buyer.ts scripts/fixtures/laya_buyer_detail.holdout.json
//
// Takes either fixture format (buyer-response "scoreable"/"safety", or buyer-detail "cases"
// with a buyer_response label). Scores the cases with the buyer's own words (the worker never
// scores a note), checks that every opt-out safety case is refused, and reports the pick and
// the same AUCs the Laya cut-offs report uses. Prints one line per case and a JSON summary.

import { readFileSync } from 'node:fs';
import { parseLayaScore } from '../src/utils/laya-answers.ts';
import { buildBuyerScoreRequest, type WorkerDeal } from '../src/utils/laya-worker.ts';
import { lfm3Identity, lfm3Options, readBuyerReply, startLfm3 } from './lfm3-buyer-reader.ts';

type Case = { id: string; lang: string; buyer_reply?: string; expected_semantic?: string | null; expected_handling?: string };
type DetailCase = { id: string; lang: string; reply: string; buyer_response: string | null };

const path = process.argv[2];
if (!path) throw new Error('Pass a fixture file.');
const raw = JSON.parse(readFileSync(path, 'utf8')) as { scoreable?: Case[]; safety?: Case[]; cases?: DetailCase[] };
const fixtures: { scoreable: Case[]; safety: Case[] } = raw.cases
  ? { scoreable: raw.cases.map(c => ({ id: c.id, lang: c.lang, buyer_reply: c.reply, expected_semantic: c.buyer_response })), safety: [] }
  : { scoreable: raw.scoreable ?? [], safety: raw.safety ?? [] };
const toDeal = (c: Case): WorkerDeal => ({
  id: c.id, product: 'Butter', buyer_reply: c.buyer_reply ?? null, last_outcome: null, stage: 'proposal', workflow_action: 'sample',
});
const scoreable = fixtures.scoreable.filter(c => c.buyer_reply && c.expected_semantic);
const optOuts = fixtures.safety.filter(c => c.buyer_reply && c.expected_handling === 'not_scored_opt_out');

const options = lfm3Options();
const identity = await lfm3Identity(options.modelPath);
const loadStart = Date.now();
const server = await startLfm3(options);
const loadMs = Date.now() - loadStart;
const rows: Array<Record<string, unknown>> = [];
const perClass: Record<string, [number, number]> = {};
try {
  for (const c of scoreable) {
    const request = buildBuyerScoreRequest(toDeal(c))!;
    const started = Date.now();
    const response = await readBuyerReply(server.endpoint, request, identity, options.contextSize);
    const ms = Date.now() - started;
    const run = response?.status === 200 ? parseLayaScore(response.payload, request.sent) : null;
    const answer = run?.answers.buyer_response;
    const choice = answer?.type === 'choice' ? answer.choice : null;
    const p = answer?.type === 'choice' ? answer.probabilities : null;
    const ok = choice === c.expected_semantic;
    const tally = (perClass[c.expected_semantic!] ??= [0, 0]); tally[0] += ok ? 1 : 0; tally[1] += 1;
    rows.push({ id: c.id, lang: c.lang, expected: c.expected_semantic, got: choice, ok, p_chosen: choice && p ? p[choice] : null, p, ms });
    console.log(`${ok ? '✓' : '✗'} ${c.id.padEnd(26)} ${c.lang} got=${String(choice).padEnd(20)} want=${String(c.expected_semantic).padEnd(20)} p=${choice && p ? p[choice].toFixed(3) : '-'} ${ms}ms`);
  }
  for (const c of optOuts) {
    const request = buildBuyerScoreRequest(toDeal(c))!;
    const response = await readBuyerReply(server.endpoint, request, identity, options.contextSize);
    const refused = response?.status === 422;
    rows.push({ id: c.id, lang: c.lang, expected: 'not_scored_opt_out', refused });
    console.log(`${refused ? '✓' : '✗'} ${c.id.padEnd(26)} ${c.lang} opt-out ${refused ? 'refused' : 'NOT refused'}`);
  }
} finally {
  await server.stop();
}
const scored = rows.filter(r => 'ok' in r);
const ms = scored.map(r => r.ms as number).sort((a, b) => a - b);
const unsure = scored.filter(r => typeof r.p_chosen === 'number' && (r.p_chosen as number) < 0.65).length;
/** P(label) ranks the replies with that label above the rest: the share of pairs in order. */
function auc(label: string): number | null {
  const score = (r: Record<string, unknown>) => ((r.p as Record<string, number> | null)?.[label] ?? 0);
  const pos = scored.filter(r => r.expected === label).map(score);
  const neg = scored.filter(r => r.expected !== label).map(score);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return Math.round((wins / (pos.length * neg.length)) * 1000) / 1000;
}
console.log(JSON.stringify({
  fixture: path,
  model: { repository: identity.repository, package_sha256: identity.package_sha256 },
  correct: `${scored.filter(r => r.ok).length}/${scored.length}`,
  thai: `${scored.filter(r => r.ok && r.lang === 'th').length}/${scored.filter(r => r.lang === 'th').length}`,
  per_class: Object.fromEntries(Object.entries(perClass).map(([k, [a, b]]) => [k, `${a}/${b}`])),
  opt_outs_refused: `${rows.filter(r => r.refused === true).length}/${optOuts.length}`,
  auc: { requested_next_step: auc('requested_next_step'), declined: auc('declined'), deferred: auc('deferred') },
  chosen_below_0_65: unsure,
  load_ms: loadMs,
  p50_ms: ms[Math.floor(ms.length / 2)],
  max_ms: ms[ms.length - 1],
}, null, 1));
