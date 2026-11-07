#!/usr/bin/env node
// Evaluate LFM3 on the whole deal set exactly as the worker runs it (same request builder,
// prompts, probabilities and validator) on a labelled buyer-detail fixture. Writes nothing
// to Supabase. Mirrors scripts/tune_laya_cutoffs.py, so the numbers compare with Laya's:
// choose cut-offs on the audit (dev) set, then score the holdout once with them.
//
//   node --no-warnings scripts/evaluate-lfm3-deal.ts scripts/fixtures/laya_buyer_detail.audit.json --save-cutoffs /tmp/lfm3-cutoffs.json
//   node --no-warnings scripts/evaluate-lfm3-deal.ts scripts/fixtures/laya_buyer_detail.holdout.json --cutoffs /tmp/lfm3-cutoffs.json
//
// Options: --out readings.json saves every reading. Prints one table and a JSON summary.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseLayaScore } from '../src/utils/laya-answers.ts';
import { buildLfm3DealRequest, type WorkerDeal } from '../src/utils/laya-worker.ts';
import { lfm3Identity, lfm3Options, readDealReply, startLfm3 } from './lfm3-buyer-reader.ts';

const NOULS = [
  'commercial_info_request', 'next_step_commitment', 'trial_reported', 'trial_positive', 'trial_negative',
  'concern_price', 'concern_technical', 'concern_delivery', 'concern_approval', 'concern_timing',
];
const GRID = Array.from({ length: 19 }, (_, i) => Math.round(0.05 * (i + 1) * 100) / 100);

type Case = Record<string, unknown> & { id: string; lang: string; reply: string };

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

/** Per-question labels; the audit set's older schema is mapped as evaluate_laya_buyer_detail.py derived_labels does. */
function labelsOf(c: Case): Record<string, boolean | null> {
  if (!('sample_trial_report' in c)) return Object.fromEntries(NOULS.map(id => [id, (c[id] as boolean | null) ?? null]));
  const sample = (c.sample_trial_report as string | null) ?? null;
  const obstacle = (c.obstacle_kind as string | null) ?? null;
  const out: Record<string, boolean | null> = {
    commercial_info_request: (c.commercial_info_request as boolean | null) ?? null,
    next_step_commitment: (c.next_step_commitment as boolean | null) ?? null,
    trial_reported: sample === null ? null : sample !== 'not_established',
    trial_positive: sample === null || sample === 'mixed_result' ? null : sample === 'positive_result',
    trial_negative: sample === null || sample === 'mixed_result' ? null : sample === 'negative_result',
  };
  for (const [id, kind] of [['concern_price', 'price_terms'], ['concern_technical', 'application_technical'],
    ['concern_delivery', 'delivery'], ['concern_approval', 'internal_approval'], ['concern_timing', 'timing']]) {
    out[id] = obstacle === null || obstacle === 'unclear' ? null : obstacle === kind;
  }
  return out;
}

function auc(scores: number[], labels: boolean[]): number | null {
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  return Math.round((wins / (pos.length * neg.length)) * 1000) / 1000;
}

function balancedAccuracy(scores: number[], labels: boolean[], cut: number): number {
  const pos = scores.filter((_, i) => labels[i]);
  const neg = scores.filter((_, i) => !labels[i]);
  return ((pos.length ? pos.filter(s => s >= cut).length / pos.length : 0) + (neg.length ? neg.filter(s => s < cut).length / neg.length : 0)) / 2;
}

/** The grid cut-off with the best balanced accuracy; ties resolve to the median tied cut-off. */
function bestCut(scores: number[], labels: boolean[]): number {
  const values = GRID.map(cut => balancedAccuracy(scores, labels, cut));
  const top = Math.max(...values);
  const tied = GRID.filter((_, i) => values[i] === top);
  return tied[Math.floor(tied.length / 2)];
}

const path = process.argv[2];
if (!path) throw new Error('Pass a fixture file.');
const cases = (JSON.parse(readFileSync(path, 'utf8')) as { cases: Case[] }).cases.filter(c => c.reply);
const givenCuts = arg('--cutoffs') ? JSON.parse(readFileSync(arg('--cutoffs')!, 'utf8')) as Record<string, number> : null;

const options = lfm3Options();
const identity = await lfm3Identity(options.modelPath);
const server = await startLfm3(options);
const readings: Array<{ id: string; lang: string; labels: Record<string, boolean | null>; buyer_response: string | null; p: Record<string, number> | null; refused?: string; ms: number }> = [];
try {
  for (const c of cases) {
    const deal: WorkerDeal = { id: c.id, product: 'Butter', buyer_reply: c.reply, last_outcome: null, stage: 'proposal', workflow_action: 'sample' };
    const request = buildLfm3DealRequest(deal)!;
    const started = Date.now();
    const response = await readDealReply(server.endpoint, request, identity, options.contextSize);
    const ms = Date.now() - started;
    const base = { id: c.id, lang: c.lang, labels: labelsOf(c), buyer_response: (c.buyer_response as string | null) ?? null, ms };
    if (response?.status === 422) { readings.push({ ...base, p: null, refused: String((response.payload as { code?: string }).code) }); continue; }
    const run = response ? parseLayaScore(response.payload, request.sent) : null;
    if (!run) { readings.push({ ...base, p: null, refused: 'invalid_or_unsure' }); continue; }
    const p: Record<string, number> = {};
    for (const id of NOULS) { const a = run.answers[id]; if (a?.type === 'noul') p[id] = a.noul; }
    const br = run.answers.buyer_response;
    if (br?.type === 'choice') for (const [label, v] of Object.entries(br.probabilities)) p[`buyer_response:${label}`] = v;
    readings.push({ ...base, p });
    process.stdout.write('.');
  }
} finally {
  await server.stop();
}
console.log('');
if (arg('--out')) writeFileSync(arg('--out')!, JSON.stringify({ fixture: path, readings }, null, 1));

const scored = readings.filter(r => r.p);
const cuts: Record<string, number> = {};
const summary: Record<string, unknown> = {};
console.log(`${'question'.padEnd(24)} ${'AUC'.padStart(5)} ${'cut'.padStart(5)} ${'EN acc'.padStart(7)} ${'TH acc'.padStart(7)}  yes`);
for (const id of NOULS) {
  const rows = scored.filter(r => r.labels[id] !== null);
  const s = rows.map(r => r.p![id]);
  const l = rows.map(r => r.labels[id] as boolean);
  const cut = givenCuts?.[id] ?? bestCut(s, l);
  cuts[id] = cut;
  const acc = (lang: string) => {
    const sub = rows.filter(r => r.lang === lang);
    return `${sub.filter(r => (r.p![id] >= cut) === r.labels[id]).length}/${sub.length}`;
  };
  const value = auc(s, l);
  summary[id] = { auc: value, cut, en: acc('en'), th: acc('th'), yes: l.filter(Boolean).length };
  console.log(`${id.padEnd(24)} ${String(value).padStart(5)} ${cut.toFixed(2).padStart(5)} ${acc('en').padStart(7)} ${acc('th').padStart(7)}  ${l.filter(Boolean).length}/${l.length}`);
}
const brRows = scored.filter(r => r.buyer_response);
const brAuc = Object.fromEntries(['requested_next_step', 'declined', 'deferred'].map(label =>
  [label, auc(brRows.map(r => r.p![`buyer_response:${label}`] ?? 0), brRows.map(r => r.buyer_response === label))]));
if (!givenCuts && arg('--save-cutoffs')) writeFileSync(arg('--save-cutoffs')!, JSON.stringify(cuts, null, 1));
const ms = readings.map(r => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({
  fixture: path,
  model: { repository: identity.repository, package_sha256: identity.package_sha256 },
  read: `${scored.length}/${readings.length}`,
  refused: readings.filter(r => r.refused).map(r => `${r.id}=${r.refused}`),
  cutoffs: givenCuts ? 'given' : 'chosen on this set',
  questions: summary,
  buyer_response_auc: brAuc,
  p50_ms_per_reply: ms[Math.floor(ms.length / 2)],
  max_ms_per_reply: ms[ms.length - 1],
}, null, 1));
