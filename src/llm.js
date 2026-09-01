/**
 * WebLLM plumbing.
 *
 * One engine, one resident model at a time. Loading five models simultaneously
 * would ask for ~5.5GB of VRAM and fail on most machines, so instead the engine
 * swaps to whichever buddy you're talking to. Weights stream from Hugging Face
 * on first use and WebLLM caches them via the Cache API, so the second swap to
 * a given buddy is fast and offline.
 *
 * Every call goes through one promise chain, because a reload racing a
 * generation is an unrecoverable engine state.
 */
import { CreateWebWorkerMLCEngine, hasModelInCache } from '@mlc-ai/web-llm';

let engine = null;
let currentModel = null;
let queue = Promise.resolve();

/** modelId -> Set<fn({progress, text})> */
const progressListeners = new Map();
/** modelId -> last progress 0..1, so a late subscriber sees where things stand. */
const lastProgress = new Map();

export function hasWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function onProgress(modelId, fn) {
  if (!progressListeners.has(modelId)) progressListeners.set(modelId, new Set());
  progressListeners.get(modelId).add(fn);
  const last = lastProgress.get(modelId);
  if (last !== undefined) fn({ progress: last, text: '' });
  return () => progressListeners.get(modelId)?.delete(fn);
}

function emitProgress(modelId, payload) {
  lastProgress.set(modelId, payload.progress);
  progressListeners.get(modelId)?.forEach((fn) => fn(payload));
}

/** Which model the engine is currently loading, so progress can be attributed. */
let loadingModel = null;

function initProgressCallback(report) {
  if (loadingModel) {
    emitProgress(loadingModel, {
      progress: report.progress ?? 0,
      text: report.text || '',
    });
  }
}

async function bootEngine(modelId) {
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    type: 'module',
  });
  loadingModel = modelId;
  engine = await CreateWebWorkerMLCEngine(worker, modelId, {
    initProgressCallback,
  });
  currentModel = modelId;
  loadingModel = null;
}

/** True if the weights are already in the browser's Cache API. */
export async function isCached(modelId) {
  try {
    return await hasModelInCache(modelId);
  } catch {
    return false;
  }
}

/**
 * Make `modelId` the resident model. Resolves once it's ready to generate.
 * Serialized against every other call in this module.
 */
export function ensureModel(modelId) {
  queue = queue.then(async () => {
    if (currentModel === modelId && engine) return;
    if (!engine) {
      await bootEngine(modelId);
      return;
    }
    loadingModel = modelId;
    try {
      await engine.reload(modelId);
      currentModel = modelId;
    } finally {
      loadingModel = null;
    }
  });
  return queue;
}

/**
 * Stream a reply.
 *
 * @param {string} modelId
 * @param {Array<{role:string, content:string}>} messages
 * @param {(full: string, delta: string) => void} onDelta
 * @param {object} [opts]
 * @returns {Promise<string>} the complete reply
 */
export function chat(modelId, messages, onDelta, opts = {}) {
  queue = queue.then(async () => {
    if (currentModel !== modelId || !engine) {
      if (!engine) await bootEngine(modelId);
      else {
        loadingModel = modelId;
        try {
          await engine.reload(modelId);
          currentModel = modelId;
        } finally {
          loadingModel = null;
        }
      }
    }

    const stream = await engine.chat.completions.create({
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.8,
      top_p: opts.top_p ?? 0.9,
      // Small models echo their own last message back at you, and a buddy who
      // repeats himself verbatim stops being a person immediately. But push
      // these past ~0.4 on a 1B model and it starts reaching for rare tokens:
      // the voice survives and the sense doesn't.
      frequency_penalty: opts.frequency_penalty ?? 0.3,
      presence_penalty: opts.presence_penalty ?? 0.3,
      // Instant messages are short. Capping hard also keeps the small models
      // from wandering off into an essay.
      max_tokens: opts.max_tokens ?? 120,
    });

    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (!delta) continue;
      full += delta;
      onDelta(full, delta);
    }
    return full.trim();
  });
  return queue;
}

export function residentModel() {
  return currentModel;
}
