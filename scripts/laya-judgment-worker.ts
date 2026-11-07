#!/usr/bin/env node
// Laya judgment worker — fills public.laya_judgments from deals' verbatim buyer replies
// and from prospects' name, industry and tags (the fit set).
//
// Runs on the Mac next to the local Laya server. One pass has two independent parts.
// Who reads the deals is --deal-reader (or LAYA_DEAL_READER): lfm3 (the default since
// 2026-11-07) or laya (the earlier setup, kept as the way back).
//
// LFM3 (deal-reader lfm3: the whole "terminal" set; deal-reader laya: the "buyer" set,
// buyer_response alone, which the app swaps into Laya's rows):
//   open deals with a verbatim reply, Thai replies included. Only when some reply has no
//   reading yet does it start llama-server with Liquid AI's LFM3-1.7B, read those replies,
//   and stop it again (scripts/lfm3-buyer-reader.ts).
//
// Laya ("fit" set for prospects; with deal-reader laya also the "terminal" set for deals):
//   1. read open deals with a buyer_reply, and prospect companies (public anon client — reads only)
//   2. skip by code: closed/parked, no verbatim reply, Thai reply; not a prospect, no industry
//      or tags; already judged for this exact input and model package
//   3. POST /score to the local server, one subject at a time
//   4. save the validated answers, or an explicit not_scored refusal (service-role key)
//
// The fit judgments order the Hermes enrichment queue: likely buyers are researched first.
// Logs counts only — never reply text or keys. Design: docs/laya-judgments-store.md.
//
// Usage:
//   node scripts/laya-judgment-worker.ts                 one pass, writes rows
//   node scripts/laya-judgment-worker.ts --watch 300     a pass every 300 s
//   node scripts/laya-judgment-worker.ts --dry-run       score but write nothing (no key needed)
//   node scripts/laya-judgment-worker.ts --fixture f.json  score labelled test replies; implies --dry-run
//   --only laya | --only lfm3    run one part (--only buyer is the old name for lfm3)
//   --deal-reader lfm3 | laya    who reads deals (default lfm3; LAYA_DEAL_READER also works)
//   --endpoint http://127.0.0.1:8765  (default; Laya's server)
//
// The service-role key is read from LAYA_WORKER_SUPABASE_SECRET or from
// ~/.config/leadpulse/supabase-secret-key, which must be readable by its owner only.
// It never belongs in .env.local, NEXT_PUBLIC_*, or the repo.

import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabase as anon } from '../src/lib/supabase.ts';
import {
  DEAL_QUESTION_SET,
  FIT_QUESTION_SET,
  buildBuyerScoreRequest,
  buildFitScoreRequest,
  buildLfm3DealRequest,
  buildScoreRequest,
  fitSkipReason,
  judgmentRowFromResponse,
  skipReason,
  type FitScoreRequest,
  type JudgmentRow,
  type ModelIdentity,
  type ScoreRequest,
  type WorkerCompany,
  type WorkerDeal,
} from '../src/utils/laya-worker.ts';
import { BUYER_QUESTION_SET } from '../src/utils/lfm3-buyer.ts';
import { lfm3Available, lfm3Identity, lfm3Options, readDealReply, startLfm3 } from './lfm3-buyer-reader.ts';

const SUPABASE_URL = 'https://mkyhikarlxuwvprjabbi.supabase.co';
const KEY_FILE = join(homedir(), '.config/leadpulse/supabase-secret-key');
const ORIGIN = 'http://localhost:3000';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '';
}

function loadSecretKey(): string {
  const fromEnv = process.env.LAYA_WORKER_SUPABASE_SECRET?.trim();
  if (fromEnv) return fromEnv;
  let mode: number;
  try {
    mode = statSync(KEY_FILE).mode & 0o777;
  } catch {
    throw new Error(`No service-role key: set LAYA_WORKER_SUPABASE_SECRET or create ${KEY_FILE} (chmod 600).`);
  }
  if (mode & 0o077) throw new Error(`${KEY_FILE} is readable by others (mode ${mode.toString(8)}); run chmod 600 on it.`);
  const key = readFileSync(KEY_FILE, 'utf8').trim();
  if (!key) throw new Error(`${KEY_FILE} is empty.`);
  return key;
}

async function health(endpoint: string): Promise<ModelIdentity> {
  const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(5000) });
  const body = await response.json() as { status?: string; model?: ModelIdentity };
  if (!response.ok || body.status !== 'ready' || !body.model) throw new Error('Local Laya server is not ready.');
  return body.model;
}

async function score(endpoint: string, body: string): Promise<{ status: number; payload: unknown }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${endpoint}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => null);
    if (response.status !== 503 || attempt === 1) return { status: response.status, payload };
    await new Promise(resolve => setTimeout(resolve, 2000)); // busy: one short retry
  }
  throw new Error('unreachable');
}

async function readDeals(fixture: string | null): Promise<WorkerDeal[]> {
  if (fixture) {
    const cases = JSON.parse(readFileSync(fixture, 'utf8')).cases as Array<{ id: string; reply: string }>;
    return cases.map(c => ({
      id: c.id, product: 'Butter', buyer_reply: c.reply, last_outcome: null, stage: 'proposal', workflow_action: 'sample',
    }));
  }
  const { data, error } = await anon
    .from('deals')
    .select('id, product, buyer_reply, last_outcome, stage, workflow_action')
    .is('deleted_at', null)
    .not('buyer_reply', 'is', null);
  if (error) throw new Error(`Could not read deals: ${error.message}`);
  return (data ?? []) as WorkerDeal[];
}

async function readProspects(): Promise<WorkerCompany[]> {
  const { data, error } = await anon
    .from('companies')
    .select('id, name, industry, tags, status')
    .is('deleted_at', null)
    .eq('status', 'prospect');
  if (error) throw new Error(`Could not read companies: ${error.message}`);
  return (data ?? []) as WorkerCompany[];
}

async function alreadyJudged(
  client: SupabaseClient,
  subject: 'deal_id' | 'company_id',
  questionSet: string,
  ids: string[],
  packageSha: string,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await client
    .from('laya_judgments')
    .select(`${subject}, input_sha256`)
    .eq('question_set', questionSet)
    .eq('model_package_sha256', packageSha)
    .in(subject, ids);
  if (error) throw new Error(`Could not read laya_judgments: ${error.message}`);
  return new Set((data ?? []).map(row => `${(row as Record<string, string>)[subject]}:${row.input_sha256}`));
}

type DealReader = 'lfm3' | 'laya';

interface PassOptions {
  endpoint: string;
  dryRun: boolean;
  fixture: string | null;
  writer: SupabaseClient | null;
  dealReader: DealReader;
}
type Counts = Record<string, number>;

/** Save one row and count the outcome under `prefix`. */
async function save(opts: PassOptions, row: JudgmentRow, prefix: string, bump: (key: string) => void) {
  bump(row.status === 'scored' ? `${prefix}scored` : `${prefix}not_scored_${row.not_scored_code}`);
  if (opts.dryRun || !opts.writer) return;
  const { error } = await opts.writer.from('laya_judgments').insert(row);
  if (!error) bump(`${prefix}saved`);
  else if (error.code === '23505') bump(`${prefix}skipped_duplicate`); // a concurrent pass saved it first
  else bump(`${prefix}failed_save`);
}

/** Laya's part: the "fit" set for prospects, and the "terminal" set when Laya reads deals. */
async function layaPass(opts: PassOptions, deals: WorkerDeal[]) {
  const counts: Counts = {};
  const bump = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };

  const model = await health(opts.endpoint);
  const requests = [];
  for (const deal of opts.dealReader === 'laya' ? deals : []) {
    const reason = skipReason(deal);
    if (reason) { bump(`skipped_${reason}`); continue; }
    const request = buildScoreRequest(deal);
    if (request) requests.push(request); else bump('skipped_not_verbatim');
  }
  const judged = opts.fixture
    ? new Set<string>()
    : await alreadyJudged(anon, 'deal_id', DEAL_QUESTION_SET, requests.map(r => r.dealId), model.package_sha256);

  // Fit judgments for prospects: never in fixture mode, which only carries test replies.
  const prospects = opts.fixture ? [] : await readProspects();
  const fitRequests: FitScoreRequest[] = [];
  for (const company of prospects) {
    const reason = fitSkipReason(company);
    if (reason) { bump(`fit_skipped_${reason}`); continue; }
    const request = buildFitScoreRequest(company);
    if (request) fitRequests.push(request);
  }
  const fitJudged = await alreadyJudged(anon, 'company_id', FIT_QUESTION_SET,
    fitRequests.map(r => r.companyId), model.package_sha256);

  const dealWork = requests.filter(r => !judged.has(`${r.dealId}:${r.inputSha256}`));
  const fitWork = fitRequests.filter(r => !fitJudged.has(`${r.companyId}:${r.inputSha256}`));
  if (requests.length > dealWork.length) counts.skipped_already_judged = requests.length - dealWork.length;
  if (fitRequests.length > fitWork.length) counts.fit_skipped_already_judged = fitRequests.length - fitWork.length;
  const work: Array<{ request: ScoreRequest | FitScoreRequest; prefix: string }> = [
    ...dealWork.map(request => ({ request, prefix: '' })),
    ...fitWork.map(request => ({ request, prefix: 'fit_' })),
  ];

  for (const { request, prefix } of work) {
    let response;
    try {
      response = await score(opts.endpoint, request.body);
    } catch {
      bump(`${prefix}failed_transport`);
      continue;
    }
    const row = judgmentRowFromResponse(request, response, model);
    if (!row) { bump(`${prefix}failed_http_${response.status}`); continue; }
    await save(opts, row, prefix, bump);
  }
  return { prospects: prospects.length, model: model.package_sha256.slice(0, 8), ...counts };
}

/**
 * LFM3's part, for every open deal with a verbatim reply, Thai included: the whole deal set
 * when LFM3 reads deals (counts "lfm3_"), or buyer_response alone when Laya does (the
 * "buyer" set, counts "buyer_"). The model is loaded only when some reply has no reading
 * yet, and stopped afterwards.
 */
async function lfm3Pass(opts: PassOptions, deals: WorkerDeal[]) {
  const whole = opts.dealReader === 'lfm3';
  const prefix = whole ? 'lfm3_' : 'buyer_';
  const counts: Counts = {};
  const bump = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
  const options = lfm3Options();
  if (!lfm3Available(options)) return { [`${prefix}reader_missing`]: 1 };

  const requests = deals.map(whole ? buildLfm3DealRequest : buildBuyerScoreRequest).filter((r): r is ScoreRequest => r !== null);
  if (requests.length === 0) return counts;
  const identity = await lfm3Identity(options.modelPath);
  const judged = opts.fixture
    ? new Set<string>()
    : await alreadyJudged(anon, 'deal_id', whole ? DEAL_QUESTION_SET : BUYER_QUESTION_SET, requests.map(r => r.dealId), identity.package_sha256);
  const work = requests.filter(r => !judged.has(`${r.dealId}:${r.inputSha256}`));
  if (requests.length > work.length) counts[`${prefix}skipped_already_judged`] = requests.length - work.length;
  if (work.length === 0) return counts; // nothing new: the model stays unloaded

  const server = await startLfm3(options);
  try {
    for (const request of work) {
      let response;
      try {
        response = await readDealReply(server.endpoint, request, identity, options.contextSize);
      } catch {
        bump(`${prefix}failed_transport`);
        continue;
      }
      if (!response) { bump(`${prefix}failed_unsure_of_labels`); continue; }
      const row = judgmentRowFromResponse(request, response, identity);
      if (!row) { bump(`${prefix}failed_invalid`); continue; }
      await save(opts, row, prefix, bump);
    }
  } finally {
    await server.stop();
  }
  return { [`${prefix}model`]: identity.package_sha256.slice(0, 8), ...counts };
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'failed');

/** One pass. The two parts fail independently: Laya still loading never blocks LFM3. */
async function pass(opts: PassOptions, parts: { laya: boolean; lfm3: boolean }) {
  const deals = await readDeals(opts.fixture);
  const summary: Record<string, unknown> = { deals: deals.length, deal_reader: opts.dealReader };
  let layaFailed = false;
  let lfm3Failed = false;
  if (parts.laya) {
    try { Object.assign(summary, await layaPass(opts, deals)); } catch (error) { layaFailed = true; summary.laya_error = message(error); }
  }
  if (parts.lfm3) {
    try { Object.assign(summary, await lfm3Pass(opts, deals)); } catch (error) { lfm3Failed = true; summary.lfm3_error = message(error); }
  }
  return { summary, layaFailed, lfm3Failed };
}

async function main(): Promise<void> {
  const endpoint = (arg('--endpoint') || 'http://127.0.0.1:8765').replace(/\/$/, '');
  const fixture = arg('--fixture') || null;
  const dryRun = arg('--dry-run') !== null || fixture !== null;
  const watch = Number(arg('--watch') || 0);
  const onlyArg = arg('--only');
  if (onlyArg !== null && onlyArg !== 'laya' && onlyArg !== 'lfm3' && onlyArg !== 'buyer') {
    console.error('--only takes laya or lfm3.');
    process.exitCode = 1;
    return;
  }
  const only = onlyArg === 'buyer' ? 'lfm3' : onlyArg as 'laya' | 'lfm3' | null;
  const readerArg = arg('--deal-reader') || process.env.LAYA_DEAL_READER || 'lfm3';
  if (readerArg !== 'lfm3' && readerArg !== 'laya') {
    console.error('--deal-reader takes lfm3 or laya.');
    process.exitCode = 1;
    return;
  }
  const dealReader: DealReader = readerArg;
  let writer: SupabaseClient | null = null;
  if (!dryRun) {
    try {
      writer = createClient(SUPABASE_URL, loadSecretKey(), { auth: { persistSession: false } });
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'No service-role key.');
      process.exitCode = 1;
      return;
    }
  }

  // LFM3 runs at most once per full interval, even when a failed Laya part retries sooner,
  // so a reply LFM3 cannot read never reloads the model every minute.
  let nextLfm3At = 0;
  do {
    const started = new Date().toISOString();
    const parts = { laya: only !== 'lfm3', lfm3: only !== 'laya' && Date.now() >= nextLfm3At };
    if (parts.lfm3) nextLfm3At = Date.now() + watch * 1000;
    let retrySoon = false;
    try {
      const { summary, layaFailed, lfm3Failed } = await pass({ endpoint, dryRun, fixture, writer, dealReader }, parts);
      console.log(JSON.stringify({ at: started, dry_run: dryRun, ...summary }));
      if (!watch && (layaFailed || lfm3Failed)) process.exitCode = 1;
      // At login the Laya server takes a minute or two to load its model: retry Laya soon.
      retrySoon = layaFailed;
    } catch (error) {
      // Messages are our own (no reply text); keep the worker alive in watch mode.
      console.error(JSON.stringify({ at: started, error: message(error) }));
      if (!watch) process.exitCode = 1;
      retrySoon = true;
    }
    if (watch > 0) await new Promise(resolve => setTimeout(resolve, (retrySoon ? Math.min(watch, 60) : watch) * 1000));
  } while (watch > 0);
}

await main();
