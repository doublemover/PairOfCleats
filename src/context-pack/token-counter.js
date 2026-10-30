import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import PQueue from 'p-queue';
import Piscina from 'piscina';
import { createIndexerThreadPool } from '../index/build/workers/thread-pool.js';
import { readVerifiedContainedFile } from '../shared/contained-file.js';
import { resolveWorkerHeapLaunchContract } from '../shared/workers/heap-contract.js';
import { destroyPiscinaPool } from '../shared/piscina-cleanup.js';
import { raceAbort, throwIfAborted } from '../shared/abort.js';
import { currentSchedulerTaskLease, withSchedulerCpuSuspended } from '../shared/concurrency/scheduler-task-scope.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';
import { contextDigest, contextProfileDigest } from '../contracts/context-token-budget.js';
import { CONTEXT_RENDERING_VERSION } from '../contracts/schemas/context-token-budget.js';
import { stableStringify } from '../shared/stable-json.js';

const queue = new PQueue({ concurrency: 1 });
const invocationScope = new AsyncLocalStorage();
const retained = new Set(), counts = new Map();
const resourceLimits = Object.freeze({ maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 });
const unavailable = cause => Object.assign(new Error('Exact rendered token accounting is unavailable.', { cause }), {
  code: 'ERR_CONTEXT_PACK_TOKENIZER_UNAVAILABLE', status: 422
});
const exactBuffer = buffer => buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
  ? buffer.buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const admit = () => {
  for (const owner of retained) {
    if (owner.isSettled()) retained.delete(owner);
    else throw owner.error;
  }
  if (queue.pending + queue.size >= 4) throw unavailable(new Error('Tokenizer admission capacity is exhausted.'));
};
const retainFailure = (error, pool, preserve = false) => {
  const failure = addStorageFailureContext(preserve ? error : unavailable(error), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => !pool || pool.destroyed === true
  }, preserve ? null : error, { secondaryPresent: !preserve });
  const observation = observeStorageResource(failure, { phase: 'context-token-count' });
  const owner = { isSettled: observation.isSettled, error: failure };
  if (!owner.isSettled()) retained.add(owner);
  return owner.error;
};

/** One invocation owns its verified profile, serial real operations and original
 * worker exit. Callers may retain only scalar counts after confirmed teardown. */
export const withRenderedContextTokenCounter = async ({ policy, repoRoot, taskPolicy, signal, timeoutMs = 10000 }, action) => {
  if (invocationScope.getStore()) throw unavailable(new Error('Nested exact counting must use its original invocation counter.'));
  throwIfAborted(signal); admit();
  if (typeof repoRoot !== 'string' || !repoRoot || typeof action !== 'function') {
    throw unavailable(new Error('Exact counting requires an explicit repository and operation owner.'));
  }
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(unavailable(new Error('Exact token-count deadline exceeded.'))),
    Math.max(1, Math.min(10000, timeoutMs)));
  const lease = currentSchedulerTaskLease();
  let settled = false, requestOwner = null, announceAdmission, proceed;
  const admitted = new Promise(resolve => { announceAdmission = resolve; });
  const resumed = new Promise(resolve => { proceed = resolve; });
  const callerFailure = failure => {
    try { throwIfAborted(signal); }
    catch (cancellation) { return addStorageFailureContext(cancellation, {}, failure, { secondaryPresent: true }); }
    return failure;
  };
  const operation = queue.add(async () => {
    announceAdmission(); await resumed;
    let pool, primary, failed = false, scopeSettled = false, preserveActionFailure = false, closing = null;
    const accepted = new Set();
    const localCounts = new Map();
    let accepting = true, running = null, blocked = null, initialized = false;
    const stats = { counts: 0, cacheHits: 0, profileLoads: 0 };
    const closePool = () => {
      if (!closing) closing = (async () => {
        if (!pool) return;
        const cleanup = await destroyPiscinaPool(pool, { label: 'context-tokenizer', destroyTimeoutMs: 1000, terminateTimeoutMs: 1000 });
        if (cleanup.skipped || cleanup.timedOut || pool.destroyed !== true) throw new Error('Tokenizer worker teardown was not confirmed within its bound.');
      })();
      return closing;
    };
    const abortWorker = () => {
      accepting = false;
      void closePool().catch(error => { blocked ||= retainFailure(error, pool); });
    };
    combined.addEventListener('abort', abortWorker, { once: true });
    try {
      throwIfAborted(combined); admitRetained(requestOwner);
      const root = path.resolve(repoRoot), profile = policy.profile, directory = path.resolve(root, profile.directory);
      const tokenizer = await readVerifiedContainedFile(root, path.join(directory, 'tokenizer.json'), {
        maxBytes: 16 * 1024 * 1024, expectedHash: profile.tokenizerSha256, signal: combined });
      const config = await readVerifiedContainedFile(root, path.join(directory, 'tokenizer_config.json'), {
        maxBytes: 512 * 1024, expectedHash: profile.configSha256, signal: combined });
      throwIfAborted(combined);
      const publish = (key, tokens, cached) => () => {
        throwIfAborted(combined);
        if (!scopeSettled || pool && pool.destroyed !== true) throw unavailable(new Error('Original tokenizer invocation exit is unconfirmed.'));
        if (cached) return;
        counts.delete(key); counts.set(key, tokens);
        while (counts.size > 512) counts.delete(counts.keys().next().value);
      };
      const counter = Object.freeze({ signal: combined, stats: () => Object.freeze({ ...stats }),
        count(text) {
          if (!accepting) return Promise.reject(unavailable(new Error('Tokenizer invocation no longer admits work.')));
          if (blocked) return Promise.reject(blocked);
          if (running || accepted.size >= 128) {
            blocked = unavailable(new Error('Tokenizer invocation requires at most 128 serial operations.'));
            return Promise.reject(blocked);
          }
          const counting = (async () => {
            throwIfAborted(combined);
            if (typeof text !== 'string' || Buffer.byteLength(text) > 131072) throw unavailable(new Error('Rendered context exceeds its exact-count input bound.'));
            stats.counts++;
            const key = contextDigest(stableStringify({ rendered: contextDigest(text), profile: contextProfileDigest(profile),
              rendering: CONTEXT_RENDERING_VERSION, taskPolicy: taskPolicy ?? null,
              budget: { maxTokens: policy.maxTokens, reservedTokens: policy.reservedTokens } }));
            if (counts.has(key) || localCounts.has(key)) {
              const global = counts.has(key), tokens = global ? counts.get(key) : localCounts.get(key);
              if (global) { counts.delete(key); counts.set(key, tokens); }
              stats.cacheHits++;
              return { tokens, publish: publish(key, tokens, global) };
            }
            if (!pool) {
              const launch = resolveWorkerHeapLaunchContract(resourceLimits);
              if (!launch.supported) throw new Error('Parent startup options prevent bounded tokenizer worker heaps.');
              pool = createIndexerThreadPool(Piscina, { filename: fileURLToPath(new URL('./tokenizer-worker.js', import.meta.url)),
                minThreads: 1, maxThreads: 1, maxQueue: 1, resourceLimits, execArgv: [], trackUnmanagedFds: true });
            }
            let inputs = {}, transferList = [];
            if (!initialized) {
              const tokenizerBytes = exactBuffer(tokenizer.buffer), configBytes = exactBuffer(config.buffer);
              inputs = { tokenizerBytes, configBytes }; transferList = [tokenizerBytes, configBytes];
            }
            const result = await raceAbort(combined, pool.run({ ...inputs, text, addSpecialTokens: profile.addSpecialTokens },
              { signal: combined, transferList }));
            if (result?.heapAcknowledged !== true || result.initialized !== !initialized
              || !Number.isSafeInteger(result.tokens) || result.tokens < 0 || result.tokens > 1048576) {
              throw new Error('Invalid tokenizer worker operation acknowledgement.');
            }
            if (result.initialized) stats.profileLoads++;
            initialized = true; throwIfAborted(combined);
            localCounts.set(key, result.tokens);
            return { tokens: result.tokens, publish: publish(key, result.tokens, false) };
          })();
          running = counting; accepted.add(counting);
          counting.then(() => { running = null; }, error => { running = null; blocked ||= error; });
          return counting;
        }
      });
      let value, actionFailure, actionFailed = false;
      try { value = await invocationScope.run(counter, () => action(counter)); }
      catch (error) { actionFailure = error; actionFailed = true; }
      accepting = false;
      const results = await Promise.allSettled([...accepted]);
      const failures = [...new Set(results.filter(result => result.status === 'rejected').map(result => result.reason))];
      if (blocked && !failures.includes(blocked)) failures.push(blocked);
      for (const error of failures) {
        if (!actionFailed) { actionFailure = error; actionFailed = true; }
        else if (error !== actionFailure) actionFailure = addStorageFailureContext(actionFailure, {}, error, { secondaryPresent: true });
      }
      if (actionFailed) { preserveActionFailure = failures.length === 0; throw actionFailure; }
      throwIfAborted(combined);
      return value;
    } catch (error) { failed = true; primary = error; }
    finally {
      accepting = false;
      // Even ignored accepted operations keep their original worker/task owner.
      await Promise.allSettled([...accepted]);
      try { await closePool(); }
      catch (error) {
        primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error; failed = true;
      }
      combined.removeEventListener('abort', abortWorker);
      if (failed) throw retainFailure(primary, pool, preserveActionFailure);
      scopeSettled = true;
    }
  }).finally(() => { settled = true; });
  lease?.trackWait(() => operation).catch(() => {});
  try {
    await withSchedulerCpuSuspended(() => raceAbort(combined, admitted));
    throwIfAborted(combined);
    if (lease && (!lease.active || !(lease.used.cpu > 0))) {
      const failure = unavailable(new Error('Tokenizer compute requires an active scheduler CPU permit.'));
      controller.abort(failure); throw failure;
    }
    const running = lease ? lease.trackWait(() => operation, { retainCpu: true }) : operation;
    proceed(); return await raceAbort(combined, running);
  } catch (error) {
    if (!settled) {
      let finished = false, failureObservation = null;
      const owner = { isSettled: () => finished && (!failureObservation || failureObservation.isSettled()), error: null };
      owner.error = addStorageFailureContext(unavailable(error), { cacheOwnershipPending: true, cacheOwnershipReleased: owner.isSettled });
      requestOwner = owner; retained.add(owner);
      void operation.then(() => { finished = true; }, failure => {
        failureObservation = observeStorageResource(failure, { phase: 'context-token-count-late' }); finished = true;
      });
      throw callerFailure(owner.error);
    }
    throw callerFailure(error);
  } finally { proceed(); clearTimeout(timer); }
};

export const countRenderedContextTokens = input => withRenderedContextTokenCounter(input, counter => counter.count(input.text));

function admitRetained(exclude) {
  for (const owner of retained) {
    if (owner === exclude) continue;
    if (owner.isSettled()) retained.delete(owner);
    else throw owner.error;
  }
}
