// LFM3 reply reader — the I/O half (the logic is src/utils/lfm3-buyer.ts). It answers
// either buyer_response alone (readBuyerReply) or the whole deal set (readDealReply).
//
// Starts Homebrew's llama-server with Liquid AI's LFM3-1.7B on 127.0.0.1 only when the
// worker has new replies to read, reads them, and stops it again: on this 8 GB Mac,
// keeping it loaded next to Laya pushed swap from 2.2 GB to 3.6 GB.
//
// Overrides (all optional):
//   LFM3_LLAMA_SERVER  /opt/homebrew/bin/llama-server
//   LFM3_MODEL_PATH    ~/Models/LiquidAI/LFM3-1.7B-GGUF/LFM3-1.7B-Q4_K_M.gguf
//   LFM3_PORT          8766
//
// Nothing here logs reply text.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ScoreRequest } from '../src/utils/laya-worker.ts';
import {
  ANSWER_PREFIX, BUYER_LABELS, LFM3_MODEL, NOUL_ANSWER_PREFIX, NO_SPELLINGS, YES_SPELLINGS, buyerMessages,
  choiceFromLabelProbabilities, hasExplicitContactOptOut, labelProbabilities, nextPrefixToQuery,
  noulFromLabelProbabilities, noulMessages, readerScoreResponse,
  type BuyerChoice, type NoulAnswer, type NoulQuestion, type ReaderIdentity,
} from '../src/utils/lfm3-buyer.ts';

export interface Lfm3Options {
  llamaServer: string;
  modelPath: string;
  port: number;
  /** tokens; a buyer reply plus the instructions is a few hundred */
  contextSize: number;
}

export function lfm3Options(env: NodeJS.ProcessEnv = process.env): Lfm3Options {
  return {
    llamaServer: env.LFM3_LLAMA_SERVER || '/opt/homebrew/bin/llama-server',
    modelPath: env.LFM3_MODEL_PATH || join(homedir(), 'Models/LiquidAI/LFM3-1.7B-GGUF/LFM3-1.7B-Q4_K_M.gguf'),
    port: Number(env.LFM3_PORT || 8766),
    contextSize: 4096,
  };
}

export function lfm3Available(options: Lfm3Options): boolean {
  return existsSync(options.llamaServer) && existsSync(options.modelPath);
}

const packageShaCache = new Map<string, string>();

/** The model's identity; the file's SHA-256 is the package hash (a new file re-judges). */
export async function lfm3Identity(modelPath: string): Promise<ReaderIdentity> {
  const { size, mtimeMs } = statSync(modelPath);
  const key = `${modelPath}:${size}:${mtimeMs}`;
  let sha = packageShaCache.get(key);
  if (!sha) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(modelPath)) hash.update(chunk as Buffer);
    sha = hash.digest('hex');
    packageShaCache.set(key, sha);
  }
  return { ...LFM3_MODEL, package_sha256: sha };
}

const running = new Set<ChildProcess>();
function stopAll() { for (const child of running) child.kill('SIGTERM'); }
process.once('exit', stopAll);
// launchd stops the worker with SIGTERM: take a loaded model down with it.
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  process.once(signal, () => { stopAll(); process.exit(code); });
}

async function post<T>(endpoint: string, path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const response = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`llama-server ${path} answered ${response.status}`);
  return response.json() as Promise<T>;
}

/** Start llama-server with the model and wait until it is ready. Always call stop(). */
export async function startLfm3(options: Lfm3Options): Promise<{ endpoint: string; stop: () => Promise<void> }> {
  const endpoint = `http://127.0.0.1:${options.port}`;
  // Something already answering on the port is not ours to use.
  const busy = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
  if (busy) throw new Error(`Port ${options.port} is already in use; set LFM3_PORT.`);

  const child = spawn(options.llamaServer, [
    '-m', options.modelPath, '--host', '127.0.0.1', '--port', String(options.port),
    '-c', String(options.contextSize), '-ngl', '99', '--parallel', '1',
  ], { stdio: 'ignore' });
  running.add(child);
  let exited = false;
  const exit = new Promise<void>(resolve => child.once('exit', () => { exited = true; running.delete(child); resolve(); }));
  const stop = async () => {
    if (exited) return;
    child.kill('SIGTERM');
    const killed = await Promise.race([exit.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 5000))]);
    if (!killed) child.kill('SIGKILL');
    await exit;
  };

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error('llama-server stopped while loading the model.');
    const ready = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok, () => false);
    if (ready) {
      // Make sure the server that answered is ours, with our model.
      const props = await fetch(`${endpoint}/props`).then(r => r.json() as Promise<{ model_path?: string }>, () => null);
      if (props?.model_path !== options.modelPath) { await stop(); throw new Error('llama-server on the port is not running LFM3.'); }
      return { endpoint, stop };
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await stop();
  throw new Error('llama-server did not load the model in 2 minutes.');
}

type TopLogprobs = { completion_probabilities?: Array<{ top_logprobs?: Array<{ id: number; logprob: number }> }> };

async function tokenize(endpoint: string, content: string): Promise<number[]> {
  const out = await post<{ tokens: number[] }>(endpoint, '/tokenize', { content, add_special: false, parse_special: true });
  return out.tokens;
}

/**
 * Read one deal's reply. Returns a Laya-shaped /score response, or null when the five
 * labels got too little of the model's probability to save a reading.
 */
type Messages = Array<{ role: string; content: string }>;

/**
 * The model's raw probability of writing each label right after `prefix`, or null when the
 * prompt leaves no room for an answer (the reply is never shortened to fit).
 */
async function labelsAfter(
  endpoint: string,
  messages: Messages,
  prefix: string,
  labels: string[],
  contextSize: number,
): Promise<{ raw: Record<string, number>; promptTokens: number } | null> {
  const { prompt: chat } = await post<{ prompt: string }>(endpoint, '/apply-template', {
    messages,
    chat_template_kwargs: { enable_thinking: false },
  });
  const prompt = chat + prefix;
  const promptTokens = await tokenize(endpoint, prompt);
  // Room for the longest label after the prompt.
  if (promptTokens.length + 16 > contextSize) return null;

  // Each label's tokens exactly as they follow this prompt.
  const labelTokens: Record<string, number[]> = {};
  for (const label of labels) {
    const whole = await tokenize(endpoint, prompt + label);
    if (whole.slice(0, promptTokens.length).join(',') !== promptTokens.join(',')) {
      throw new Error('A label changed how the prompt tokenizes.');
    }
    labelTokens[label] = whole.slice(promptTokens.length);
  }

  const nextLogprobs = new Map<string, Map<number, number>>();
  for (let next = nextPrefixToQuery(labelTokens, nextLogprobs); next; next = nextPrefixToQuery(labelTokens, nextLogprobs)) {
    const out = await post<TopLogprobs>(endpoint, '/completion', {
      prompt: [...promptTokens, ...next],
      n_predict: 1,
      n_probs: 20,
      temperature: 0,
      cache_prompt: true,
    });
    const top = out.completion_probabilities?.[0]?.top_logprobs ?? [];
    nextLogprobs.set(next.join(','), new Map(top.map(t => [t.id, t.logprob])));
  }
  return { raw: labelProbabilities(labelTokens, nextLogprobs), promptTokens: promptTokens.length };
}

/** buyer_response, or 'too_long', or null when the five labels got too little probability. */
async function readChoice(endpoint: string, state: string, contextSize: number) {
  const read = await labelsAfter(endpoint, buyerMessages(state), ANSWER_PREFIX, BUYER_LABELS, contextSize);
  if (!read) return 'too_long' as const;
  const choice = choiceFromLabelProbabilities(read.raw);
  return choice ? { answer: choice.answer, promptTokens: read.promptTokens } : null;
}

/** One yes/no question, or 'too_long'. */
async function readNoul(endpoint: string, state: string, question: NoulQuestion, contextSize: number) {
  const read = await labelsAfter(endpoint, noulMessages(state, question), NOUL_ANSWER_PREFIX, [...YES_SPELLINGS, ...NO_SPELLINGS], contextSize);
  if (!read) return 'too_long' as const;
  return { answer: noulFromLabelProbabilities(read.raw).answer, promptTokens: read.promptTokens };
}

/**
 * Read one reply for the "buyer" set: buyer_response alone. Null when the labels got too
 * little probability (nothing is saved; the next pass tries again).
 */
export async function readBuyerReply(
  endpoint: string,
  request: ScoreRequest,
  identity: ReaderIdentity,
  contextSize: number,
): Promise<{ status: number; payload: unknown } | null> {
  return readDealReply(endpoint, request, identity, contextSize);
}

/**
 * Read one reply for every question its request asks: buyer_response with the label
 * method, each yes/no question with its own prompt. An opt-out is refused before the model
 * runs; a reply too long for any prompt is refused as input_too_long. Null when
 * buyer_response's labels got too little probability: the whole reading is dropped.
 */
export async function readDealReply(
  endpoint: string,
  request: ScoreRequest,
  identity: ReaderIdentity,
  contextSize: number,
): Promise<{ status: number; payload: unknown } | null> {
  const { sent } = request;
  if (hasExplicitContactOptOut(sent.state)) return readerScoreResponse(sent, { notScored: 'contact_opt_out' }, identity);

  const answers: Record<string, BuyerChoice | NoulAnswer> = {};
  let inputTokens = 0;
  for (const [id, question] of Object.entries(sent.questions) as Array<[string, { type: string }]>) {
    let read;
    if (question.type === 'choice' && id === 'buyer_response') read = await readChoice(endpoint, sent.state, contextSize);
    else if (question.type === 'noul') read = await readNoul(endpoint, sent.state, question as NoulQuestion, contextSize);
    else throw new Error(`LFM3 cannot answer ${id} (${question.type}).`);
    if (read === 'too_long') return readerScoreResponse(sent, { notScored: 'input_too_long' }, identity);
    if (!read) return null;
    answers[id] = read.answer;
    inputTokens = Math.max(inputTokens, read.promptTokens);
  }
  return readerScoreResponse(sent, { answers, inputTokens }, identity);
}
