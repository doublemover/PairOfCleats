import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PQueue from 'p-queue';
import Piscina from 'piscina';
import { IndexerThreadPool } from '../index/build/workers/thread-pool.js';
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
const retainFailure = (error, pool) => {
  const failure = addStorageFailureContext(unavailable(error), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => !pool || pool.destroyed === true
  }, error, { secondaryPresent: true });
  const observation = observeStorageResource(failure, { phase: 'context-token-count' });
  const owner = { isSettled: observation.isSettled, error: failure };
  if (!owner.isSettled()) retained.add(owner);
  return owner.error;
};

/** Exact bounded operation. The queue retains original reads/tasks until they
 * settle, even if a caller deadline returns first. Failed worker owners block
 * later counting until the captured destructor confirms their actual exits. */
export const countRenderedContextTokens = async ({ text, policy, repoRoot, taskPolicy, signal, timeoutMs = 10000 }) => {
  throwIfAborted(signal); admit();
  if (typeof repoRoot !== 'string' || !repoRoot || typeof text !== 'string' || Buffer.byteLength(text) > 131072) {
    throw unavailable(new Error('Exact counting requires an explicit repository and a bounded rendered context.'));
  }
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(unavailable(new Error('Exact token-count deadline exceeded.'))),
    Math.max(1, Math.min(10000, timeoutMs)));
  let settled = false, requestOwner = null;
  const lease = currentSchedulerTaskLease();
  let announceAdmission, proceed;
  const admitted = new Promise(resolve => { announceAdmission = resolve; });
  const resumed = new Promise(resolve => { proceed = resolve; });
  const callerFailure = failure => {
    try { throwIfAborted(signal); }
    catch (cancellation) { return addStorageFailureContext(cancellation, {}, failure, { secondaryPresent: true }); }
    return failure;
  };
  const operation = queue.add(async () => {
    announceAdmission();
    await resumed;
    let pool, primary, failed = false;
    try {
      throwIfAborted(combined); admitRetained(requestOwner);
      const root = path.resolve(repoRoot), directory = path.resolve(root, policy.profile.directory);
      const profile = policy.profile;
      // Both fixed inputs are checked against the actual admitted repository,
      // never an inferred global model directory or a caller-supplied filename.
      const tokenizer = await readVerifiedContainedFile(root, path.join(directory, 'tokenizer.json'), {
        maxBytes: 16 * 1024 * 1024, expectedHash: profile.tokenizerSha256, signal: combined });
      const config = await readVerifiedContainedFile(root, path.join(directory, 'tokenizer_config.json'), {
        maxBytes: 512 * 1024, expectedHash: profile.configSha256, signal: combined });
      throwIfAborted(combined);
      const key = contextDigest(stableStringify({ rendered: contextDigest(text), profile: contextProfileDigest(profile),
        rendering: CONTEXT_RENDERING_VERSION, taskPolicy: taskPolicy ?? null,
        budget: { maxTokens: policy.maxTokens, reservedTokens: policy.reservedTokens } }));
      if (counts.has(key)) {
        const tokens = counts.get(key); counts.delete(key); counts.set(key, tokens);
        return { tokens, publish: () => {} };
      }
      const launch = resolveWorkerHeapLaunchContract(resourceLimits);
      if (!launch.supported) throw new Error('Parent startup options prevent bounded tokenizer worker heaps.');
      pool = new IndexerThreadPool(new Piscina({ filename: fileURLToPath(new URL('./tokenizer-worker.js', import.meta.url)),
        minThreads: 0, maxThreads: 1, maxQueue: 1, resourceLimits, execArgv: [], trackUnmanagedFds: true }));
      const tokenizerBytes = exactBuffer(tokenizer.buffer), configBytes = exactBuffer(config.buffer);
      const result = await raceAbort(combined, pool.run({ tokenizerBytes, configBytes, text,
        addSpecialTokens: profile.addSpecialTokens }, { signal: combined, transferList: [tokenizerBytes, configBytes] }));
      if (result?.heapAcknowledged !== true || !Number.isSafeInteger(result.tokens) || result.tokens < 0 || result.tokens > 1048576) {
        throw new Error('Invalid tokenizer worker acknowledgement.');
      }
      throwIfAborted(combined);
      return { tokens: result.tokens, publish: () => {
        throwIfAborted(combined);
        if (pool.destroyed !== true) throw unavailable(new Error('Original tokenizer worker exit is unconfirmed.'));
        counts.delete(key); counts.set(key, result.tokens);
        while (counts.size > 512) counts.delete(counts.keys().next().value);
      } };
    } catch (error) { failed = true; primary = error; }
    finally {
      if (pool) {
        try {
          const cleanup = await destroyPiscinaPool(pool, { label: 'context-tokenizer', destroyTimeoutMs: 1000, terminateTimeoutMs: 1000 });
          if (cleanup.skipped || cleanup.timedOut || pool.destroyed !== true) throw new Error('Tokenizer worker teardown was not confirmed within its bound.');
        } catch (error) {
          primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error; failed = true;
        }
      }
      if (failed) throw retainFailure(primary, pool);
    }
  }).finally(() => { settled = true; });
  // Waiting for serialized admission lends only CPU. The original request keeps
  // memory/task ownership; active worker execution then retains its CPU permit
  // through original teardown, including an early caller cancellation.
  lease?.trackWait(() => operation).catch(() => {});
  try {
    await withSchedulerCpuSuspended(() => raceAbort(combined, admitted));
    throwIfAborted(combined);
    if (lease && (!lease.active || !(lease.used.cpu > 0))) {
      const failure = unavailable(new Error('Tokenizer compute requires an active scheduler CPU permit.'));
      controller.abort(failure); throw failure;
    }
    const running = lease ? lease.trackWait(() => operation, { retainCpu: true }) : operation;
    proceed();
    return await raceAbort(combined, running);
  }
  catch (error) {
    if (!settled) {
      let finished = false, failureObservation = null;
      const owner = { isSettled: () => finished && (!failureObservation || failureObservation.isSettled()), error: null };
      owner.error = addStorageFailureContext(unavailable(error), {
        cacheOwnershipPending: true, cacheOwnershipReleased: owner.isSettled
      });
      requestOwner = owner; retained.add(owner);
      void operation.then(() => { finished = true; }, failure => {
        failureObservation = observeStorageResource(failure, { phase: 'context-token-count-late' }); finished = true;
      });
      throw callerFailure(owner.error);
    }
    throw callerFailure(error);
  } finally { proceed(); clearTimeout(timer); }
};
function admitRetained(exclude) {
  for (const owner of retained) {
    if (owner === exclude) continue;
    if (owner.isSettled()) retained.delete(owner);
    else throw owner.error;
  }
}
