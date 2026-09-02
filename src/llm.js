/**
 * WebLLM plumbing.
 *
 * One engine, one resident model, for the entire life of the page. Two sets of
 * GPU buffers is not "slow", it is a dead tab — Safari on a phone will kill the
 * process outright rather than swap. So there is exactly one `MLCEngine` here
 * and a buddy switch is `engine.reload()`, never a second construction.
 *
 * Everything is serialized through one chain, because a reload racing a
 * generation leaves the engine in a state nothing can recover from. The chain
 * is deliberately built so that a *failed* call cannot poison the calls behind
 * it: `queue` always holds a settled-clean promise, and the rejection is handed
 * to the caller only. Getting this wrong means one OOM kills every buddy for
 * the rest of the session.
 */
import { CreateWebWorkerMLCEngine, hasModelInCache } from '@mlc-ai/web-llm';

let engine = null;
let worker = null;
let currentModel = null;

/** Always resolves. Never hand this to a caller; see `enqueue`. */
let queue = Promise.resolve();

/** modelId -> Set<fn({progress, text})> */
const progressListeners = new Map();
/** modelId -> last progress 0..1, so a late subscriber sees where things stand. */
const lastProgress = new Map();

/**
 * Run `fn` after everything already queued, whether those succeeded or not.
 *
 * The caller gets a promise that rejects on failure; the internal chain gets
 * one that never does. Without that split, `queue = queue.then(fn)` means the
 * first rejection is inherited by every subsequent link forever and the app
 * silently stops working.
 */
function enqueue(fn) {
  const run = () => fn();
  const next = queue.then(run, run);
  queue = next.then(
    () => {},
    () => {}
  );
  return next;
}

/* --------------------------------------------------------------------------
   Capability probing

   `navigator.gpu` existing is not the same as WebGPU being usable. iOS 26 ships
   WebGPU with buffer limits far below desktop Chrome's, and an allocation over
   the limit throws *after* device creation succeeds — so the only honest check
   is to create a device and read its limits.
   -------------------------------------------------------------------------- */

/**
 * The smallest buddy is SmolLM2-360M at ~376 MB of weights. MLC allocates
 * those as a handful of storage buffers, and the largest single one has to fit
 * under `maxStorageBufferBindingSize`. 128 MB is the WebGPU spec floor and is
 * what a device has to clear to have any chance; below that, nothing here runs.
 */
const MIN_STORAGE_BINDING = 128 * 1024 * 1024;
const MIN_BUFFER_SIZE = 256 * 1024 * 1024;

/** Cheap synchronous check. True only means "worth probing properly". */
export function hasWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

let capabilityPromise = null;

/**
 * Three-tier answer, cached for the page.
 *
 * @returns {Promise<{tier:'ok'|'limited'|'none', reason?:string, limits?:object}>}
 *   'none'    — no WebGPU at all, or no adapter. Nothing will run.
 *   'limited' — WebGPU exists but the device cannot hold the smallest buddy.
 *   'ok'      — go.
 */
export function probeWebGPU() {
  if (!capabilityPromise) capabilityPromise = runProbe();
  return capabilityPromise;
}

async function runProbe() {
  if (!hasWebGPU()) {
    return { tier: 'none', reason: 'This browser has no WebGPU support.' };
  }
  let adapter;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (err) {
    return { tier: 'none', reason: describe(err) };
  }
  if (!adapter) {
    return {
      tier: 'none',
      reason: 'No graphics adapter is available to this browser.',
    };
  }

  const limits = {
    maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize ?? 0,
    maxBufferSize: adapter.limits?.maxBufferSize ?? 0,
  };

  if (
    limits.maxStorageBufferBindingSize < MIN_STORAGE_BINDING ||
    limits.maxBufferSize < MIN_BUFFER_SIZE
  ) {
    return { tier: 'limited', limits };
  }

  return { tier: 'ok', limits };
}

/* --------------------------------------------------------------------------
   Error classification

   Two failures matter and they want opposite handling. Running out of memory
   is fatal and has to end the session. Failing to *cache* the weights is not
   fatal at all — the model is already in GPU memory and works fine for this
   session; it just won't be there tomorrow. Showing an error for the second
   one trains people to ignore the first.
   -------------------------------------------------------------------------- */

function describe(err) {
  return String(err?.message || err?.name || err || 'unknown error');
}

/** Out of memory, buffer allocation refused, device lost under pressure. */
export function isOOMError(err) {
  const s = describe(err).toLowerCase();
  return (
    /out of memory|oom\b|allocation (failed|size)|failed to allocate/.test(s) ||
    /exceeds the (maximum|limit)|larger than the maximum|maxstoragebufferbindingsize|maxbuffersize/.test(s) ||
    /device (was )?lost|createbuffer|memory limit/.test(s) ||
    (err?.name === 'QuotaExceededError' && /buffer|gpu/.test(s))
  );
}

/** Cache API / storage rejection. Survivable — the weights are already loaded. */
export function isStorageError(err) {
  const s = describe(err).toLowerCase();
  if (isOOMError(err)) return false;
  return (
    err?.name === 'QuotaExceededError' ||
    /quota|storage|cache(s)? api|opfs|indexeddb|disk|write failed/.test(s)
  );
}

export class OutOfMemoryError extends Error {
  constructor(modelId, cause) {
    super(`Not enough memory for ${modelId}: ${describe(cause)}`);
    this.name = 'OutOfMemoryError';
    this.modelId = modelId;
    this.cause = cause;
  }
}

/* --------------------------------------------------------------------------
   Progress
   -------------------------------------------------------------------------- */

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

/* --------------------------------------------------------------------------
   Engine lifecycle
   -------------------------------------------------------------------------- */

/**
 * Release the GPU entirely. Called on OOM, so it has to work even when the
 * engine is in a bad state — every step is independently guarded.
 */
export async function teardown() {
  const e = engine;
  const w = worker;
  engine = null;
  worker = null;
  currentModel = null;
  loadingModel = null;
  lastProgress.clear();
  try {
    await e?.unload();
  } catch {
    /* already gone */
  }
  try {
    w?.terminate();
  } catch {
    /* already gone */
  }
}

async function bootEngine(modelId) {
  // Construct the worker and the engine together, and tear both down if either
  // fails — otherwise a retry after an OOM spawns a second worker alongside the
  // orphaned first one, which is exactly the wrong thing to do while the device
  // is already short on memory.
  const w = new Worker(new URL('./worker.js', import.meta.url), {
    type: 'module',
  });
  loadingModel = modelId;
  try {
    engine = await CreateWebWorkerMLCEngine(w, modelId, { initProgressCallback });
    worker = w;
    currentModel = modelId;
  } catch (err) {
    try {
      w.terminate();
    } catch {
      /* nothing to clean up */
    }
    engine = null;
    worker = null;
    currentModel = null;
    throw err;
  } finally {
    loadingModel = null;
  }
}

async function swapTo(modelId) {
  if (!engine) return bootEngine(modelId);
  loadingModel = modelId;
  try {
    await engine.reload(modelId);
    currentModel = modelId;
  } finally {
    loadingModel = null;
  }
}

/**
 * Bring `modelId` in, translating a memory failure into a typed error and
 * releasing the GPU on the way out so the app has somewhere to land.
 *
 * A storage failure is swallowed on purpose: the weights are in memory and the
 * conversation works, it simply won't be cached for next time.
 */
async function load(modelId) {
  if (currentModel === modelId && engine) return;
  try {
    await swapTo(modelId);
  } catch (err) {
    if (isStorageError(err)) {
      // Couldn't persist to the Cache API. If the engine came up anyway, that
      // is a fine place to be; say nothing and carry on.
      if (engine && currentModel === modelId) {
        console.warn('Model cache unavailable; running from memory only.', err);
        return;
      }
      console.warn('Storage rejected the model cache.', err);
    }
    if (isOOMError(err)) {
      await teardown();
      throw new OutOfMemoryError(modelId, err);
    }
    throw err;
  }
}

/** True if the weights are already in the browser's Cache API. */
export async function isCached(modelId) {
  try {
    return await hasModelInCache(modelId);
  } catch {
    // Storage is unavailable. Not an error worth surfacing — it only means we
    // cannot promise the download will be quick.
    return false;
  }
}

/**
 * The load currently queued or running, so that a double-tap on a buddy joins
 * the load already in flight instead of queueing a second identical reload
 * behind it. The chain would make that *safe* either way; this makes it free.
 */
let pending = null;

/**
 * Make `modelId` the resident model. Resolves once it's ready to generate.
 * Serialized against every other call in this module.
 */
export function ensureModel(modelId) {
  if (pending && pending.modelId === modelId) return pending.promise;
  const promise = enqueue(() => load(modelId));
  pending = { modelId, promise };
  const clear = () => {
    if (pending?.promise === promise) pending = null;
  };
  promise.then(clear, clear);
  return promise;
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
  return enqueue(async () => {
    await load(modelId);

    let stream;
    try {
      stream = await engine.chat.completions.create({
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
    } catch (err) {
      // Generation can OOM too — the KV cache grows with the conversation, so a
      // long night is exactly when it happens.
      if (isOOMError(err)) {
        await teardown();
        throw new OutOfMemoryError(modelId, err);
      }
      throw err;
    }
  });
}

export function residentModel() {
  return currentModel;
}
