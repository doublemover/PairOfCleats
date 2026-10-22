import { validateIncrementalBundleShardAuthority } from '../../../index/build/incremental/bundle-snapshot.js';
import { resolveWorkerHeapLaunchContract } from '../../../shared/workers/heap-contract.js';
import { restoreIndexFormatError } from '../../../shared/index-format-error.js';
import { throwIfAborted, isAbortError, composeAbortSignals } from '../../../shared/abort.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import Piscina from 'piscina';
import { resolveManifestBundleNamesResult, resolveBundleFormatFromName, resolveBundlePatchPath } from '../../../shared/bundle-io-paths.js';
import { readBundleFile } from '../../../shared/bundle-io.js';
import { MAX_BUNDLE_BYTES, MAX_BUNDLE_PATCH_BYTES } from '../../../shared/bundle-contract.js';
import { readEffectiveMemory } from '../../../shared/effective-memory.js';
import { destroyPiscinaPool } from '../../../shared/piscina-cleanup.js';
import { createTimeoutError, runWithTimeout } from '../../../shared/promise-timeout.js';
import { buildWorkerExecArgv, parseMaxOldSpaceSizeMb } from '../../../shared/workers/node-argv.js';
import { measureBundleProjectionBytes } from './bundle-projection-size.js';
import { orderedBundleShardWindow } from './bundle-pipeline.js';
const retainedFailedPools = new Set();
let quarantine = null;
const MiB = 1024 * 1024;
const resolveWorkerResourceLimits = maxWorkers => {
  const totalMemMb = Math.floor((readEffectiveMemory().totalBytes || 256 * MiB) / MiB);
  const maxOldMb = parseMaxOldSpaceSizeMb(process.execArgv);
  const basisMb = Math.max(256, Math.min(2048, totalMemMb, maxOldMb || totalMemMb));
  return { maxOldGenerationSizeMb: Math.max(128, Math.min(process.platform === 'win32' ? 256 : 512,
    Math.floor(basisMb / (Math.max(1, maxWorkers) * 2)))), maxYoungGenerationSizeMb: 32 };
};

export const createBundleLoader = ({ bundleThreads, workerPath, repoRoot = process.cwd(), signal = null }) => {
  throwIfAborted(signal); if (quarantine) throw quarantine;
  const bundleTaskTimeoutMs = 30000;
  const requestedRaw = Number(bundleThreads);
  const requestedThreads = Number.isFinite(requestedRaw) && requestedRaw > 0
    ? Math.max(1, Math.min(32, Math.floor(requestedRaw))) : 1;
  const resourceLimits = resolveWorkerResourceLimits(requestedThreads);
  const memoryThreads = Math.max(1, Math.floor(readEffectiveMemory().freeBytes
    / (resourceLimits.maxOldGenerationSizeMb * MiB * 2)));
  const maxThreads = Math.min(requestedThreads, memoryThreads);
  const heapContract = resolveWorkerHeapLaunchContract(resourceLimits);
  const useWorkers = requestedThreads > 1 && Boolean(workerPath) && heapContract.supported;
  const workerAdmissionReason = !heapContract.supported ? heapContract.reason
    : maxThreads < requestedThreads ? 'effective-memory-cap' : null;
  const pool = useWorkers ? new Piscina({ filename: workerPath, minThreads: 0, maxThreads,
    execArgv: buildWorkerExecArgv(), taskTimeout: bundleTaskTimeoutMs, resourceLimits }) : null;
  let workerAvailable = Boolean(pool), closed = false, destroyPromise = null;
  const destroyWorkerPool = () => {
    workerAvailable = false;
    if (!pool) return Promise.resolve();
    if (destroyPromise) return destroyPromise;
    destroyPromise = (async () => {
      try { await destroyPiscinaPool(pool, { label: 'sqlite.bundle-loader.worker-pool', destroyTimeoutMs: 5000 }); }
      catch (error) {
        retainedFailedPools.add(pool);
        error.cacheOwnershipPending = true;
        quarantine = error;
        throw error;
      }
    })();
    return destroyPromise;
  };
  const close = () => { closed = true; return destroyWorkerPool(); };
  const invalidTask = (file, reason) => ({ file, shardIndex: 0, shardCount: 1, finalShard: true,
    reservedBytes: 1, invalidResult: { file, ok: false, reason } });
  async function* shardTasks(records, bundleDir) {
    for (const record of records) {
      throwIfAborted(signal);
      const { file, entry } = record;
      const names = resolveManifestBundleNamesResult(entry);
      if (!names.ok || !names.names.length) { yield invalidTask(file, names.reason || 'missing bundle entries'); continue; }
      if (names.names.some(name => /^(snapshot|resume)-[a-f0-9]{64}\.(json|mpk)$/.test(name)) && !Array.isArray(entry.bundleInventory)) {
        yield invalidTask(file, 'missing selected immutable bundle inventory'); continue;
      }
      if (entry.bundleInventory != null && (!Array.isArray(entry.bundleInventory)
        || entry.bundleInventory.length !== names.names.length)) {
        yield invalidTask(file, 'incomplete selected bundle inventory'); continue;
      }
      for (let index = 0; index < names.names.length; index++) {
        throwIfAborted(signal);
        const bundlePath = path.join(bundleDir, names.names[index]);
        let stat;
        try { stat = await fs.lstat(bundlePath); }
        catch (error) {
          if (error.code === 'ENOENT') { yield invalidTask(file, 'bundle file missing (' + bundlePath + ')'); break; }
          throw error;
        }
        if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size) || stat.size > MAX_BUNDLE_BYTES) {
          yield invalidTask(file, 'bundle is not a bounded regular file (' + bundlePath + ')'); break;
        }
        let patchBytes = 0;
        try {
          const patchStat = await fs.lstat(resolveBundlePatchPath(bundlePath));
          if (!patchStat.isFile() || patchStat.isSymbolicLink() || !Number.isSafeInteger(patchStat.size)
            || patchStat.size > MAX_BUNDLE_PATCH_BYTES) {
            yield invalidTask(file, 'bundle patch is not a bounded regular file (' + bundlePath + ')'); break;
          }
          patchBytes = patchStat.size;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const authority = entry.bundleInventory ? { relKey: file, sourceHash: entry.hash, sourceSize: entry.size,
          dependencySignatures: entry.dependencySignatures, bundleName: names.names[index],
          part: entry.bundleInventory[index], index, count: names.names.length,
          format: entry.bundleFormat || resolveBundleFormatFromName(names.names[index]) } : null;
        const maxProjectionBytes = Math.max(65536, (stat.size + patchBytes) * 64 + 65536);
        // Account encoded input/string scratch plus two admitted projections
        // during worker -> parent cloning. These units are not measured RSS.
        yield { file, bundlePath, authority, patchBytes, encodedBytes: stat.size, maxEncodedBytes: stat.size || 1, maxProjectionBytes,
          reservedBytes: (stat.size + patchBytes) * 3 + maxProjectionBytes * 2 + MiB,
          shardIndex: index, shardCount: names.names.length, finalShard: index === names.names.length - 1 };
      }
    }
  }
  const loadShard = async (task, operationSignal = signal) => {
    const currentSignal = composeAbortSignals(signal, operationSignal);
    throwIfAborted(currentSignal); if (quarantine) throw quarantine;
    if (closed) throw new Error('SQLite bundle loader closed.');
    const metadata = { file: task.file, shardIndex: task.shardIndex, shardCount: task.shardCount, finalShard: task.finalShard };
    if (task.invalidResult) return { ...task.invalidResult, ...metadata };
    let result;
    try {
      if (pool && workerAvailable) {
        try {
          result = await runWithTimeout(() => pool.run({ bundlePath: task.bundlePath, repoRoot,
            encodedBytes: task.encodedBytes, maxEncodedBytes: task.maxEncodedBytes, expectedPatchBytes: task.patchBytes,
            maxProjectionBytes: task.maxProjectionBytes, authority: task.authority }, { signal: currentSignal }), {
            timeoutMs: bundleTaskTimeoutMs, signal: currentSignal,
            errorFactory: () => createTimeoutError({ message: 'bundle worker timed out (' + task.bundlePath + ')',
              code: 'SQLITE_BUNDLE_WORKER_TIMEOUT', retryable: false }) });
          throwIfAborted(currentSignal);
          if (result?.heapBoundUnavailable) { await destroyWorkerPool(); result = null; }
          if (['EACCES', 'EPERM'].includes(result?.errorCode)) throw Object.assign(new Error(result.reason), { code: result.errorCode });
          if (result?.formatError) throw restoreIndexFormatError(result.formatError);
          if (result && !result.ok) return { ...metadata, ok: false, reason: 'bundle read failed (' + task.bundlePath + '): ' + (result?.reason || 'invalid bundle') };
        } catch (error) {
          if (isAbortError(error) || currentSignal?.aborted) { throwIfAborted(currentSignal); throw error; }
          if (['ERR_INDEX_FORMAT_UNSUPPORTED', 'EACCES', 'EPERM'].includes(error.code)) throw error;
          // No inline parse overlaps a worker whose retirement is uncertain.
          await destroyWorkerPool();
        }
      }
      if (!result?.ok) {
        result = await readBundleFile(task.bundlePath, { repoRoot, maxBytes: task.maxEncodedBytes,
          expectedEncodedBytes: task.encodedBytes, expectedPatchBytes: task.patchBytes, signal: currentSignal });
        throwIfAborted(currentSignal);
        if (!result.ok) return { ...metadata, ok: false, reason: 'bundle read failed (' + task.bundlePath + '): ' + result.reason };
      }
      throwIfAborted(currentSignal);
      // Independently validate worker result shape/size before inserting; a
      // transport envelope alone cannot authorize unbounded parent retention.
      if (task.authority && !validateIncrementalBundleShardAuthority({ ...task.authority, bundle: result.bundle })) {
        return { ...metadata, ok: false, reason: 'bundle differs from selected manifest snapshot (' + task.bundlePath + ')' };
      }
      const projectionBytes = measureBundleProjectionBytes(result.bundle, task.maxProjectionBytes);
      return { ...metadata, ok: true, bundleShards: [result.bundle], encodedBytes: task.encodedBytes, projectionBytes };
    } catch (error) {
      if (quarantine || error.cacheOwnershipPending || isAbortError(error)
        || currentSignal?.aborted || ['ERR_INDEX_FORMAT_UNSUPPORTED', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      return { ...metadata, ok: false, reason: 'bundle read failed (' + task.bundlePath + '): ' + (error.message || error) };
    }
  };
  const iterateBundleShards = (records, { bundleDir, maxBytes, metrics = {} }) => orderedBundleShardWindow({
    source: shardTasks(records, bundleDir), load: loadShard, concurrency: useWorkers ? maxThreads : 1,
    maxBytes, signal, metrics, close });
  // Compatibility for explicit full-file callers; production SQLite ingestion
  // consumes the ordered shard stream and never accumulates a file's shards.
  const loadBundle = async ({ bundleDir, entry, file }) => {
    const bundleShards = [];
    for await (const task of shardTasks([{ file, entry }], bundleDir)) {
      const result = await loadShard(task);
      if (!result.ok) return result;
      bundleShards.push(...result.bundleShards);
    }
    return { file, ok: true, bundleShards };
  };
  return { loadBundle, iterateBundleShards, close, useWorkers, maxThreads, workerAdmissionReason };
};
