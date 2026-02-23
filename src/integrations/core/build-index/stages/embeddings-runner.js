import crypto from 'node:crypto';
import path from 'node:path';
import { logLine, showProgress } from '../../../../shared/progress.js';
import { isAbortError, throwIfAborted } from '../../../../shared/abort.js';
import {
  getCacheRoot,
  getCurrentBuildInfo,
  getIndexDir
} from '../../../../../tools/shared/dict-utils.js';
import { ensureQueueDir, enqueueJob } from '../../../../../tools/service/queue.js';
import { runEmbeddingsTool } from '../../embeddings.js';
import {
  PRIMARY_INDEX_MODES,
  areAllPrimaryModesRequested,
  dedupeModeList
} from './modes.js';
import { acquireBuildIndexLock } from './lock.js';

/**
 * Execute embeddings stage (inline or queued service mode) for requested modes.
 *
 * Transition and failure contract:
 * 1. Stage acquires the global build/index lock before enqueueing/running work.
 * 2. Stage always releases the lock in `finally`, even when embeddings fail.
 * 3. Abort errors are rethrown and recorded as `aborted`, other failures as `error`.
 * 4. Result payload stays in deterministic stage3 shape for all outcomes.
 *
 * @param {object} input
 * @param {string} input.root
 * @param {object} input.argv
 * @param {string[]} input.embedModes
 * @param {object} input.embeddingRuntime
 * @param {object|null} input.userConfig
 * @param {string|null} input.indexRoot
 * @param {boolean} input.includeEmbeddings
 * @param {{current?:{advance?:(state:object)=>void}}} input.overallProgressRef
 * @param {(line:string)=>void} input.log
 * @param {AbortSignal|null} input.abortSignal
 * @param {string} input.repoCacheRoot
 * @param {NodeJS.ProcessEnv} input.runtimeEnv
 * @param {(stage:string,status:'ok'|'error'|'aborted',started:bigint)=>void} input.recordIndexMetric
 * @param {string} input.buildEmbeddingsPath
 * @returns {Promise<object>}
 */
export const runEmbeddingsStage = async ({
  root,
  argv,
  embedModes,
  embeddingRuntime,
  userConfig,
  indexRoot,
  includeEmbeddings,
  overallProgressRef,
  log,
  abortSignal,
  repoCacheRoot,
  runtimeEnv,
  recordIndexMetric,
  buildEmbeddingsPath
}) => {
  const started = process.hrtime.bigint();
  const fileProgressPattern = /^\[embeddings\]\s+([^:]+):\s+processed\s+(\d+)\/(\d+)\s+files\b/;
  const recordOk = (result) => {
    recordIndexMetric('stage3', 'ok', started);
    return result;
  };
  try {
    throwIfAborted(abortSignal);
    if (!embeddingRuntime.embeddingEnabled) {
      log('Embeddings disabled; skipping stage3.');
      return recordOk({ modes: embedModes, embeddings: { skipped: true }, repo: root, stage: 'stage3' });
    }

    // Throughput: preserve caller-facing `modes` while avoiding duplicate execution work.
    const executionEmbedModes = dedupeModeList(embedModes);
    const explicitIndexRoot = argv['index-root'] ? path.resolve(argv['index-root']) : null;
    const providedIndexRoot = indexRoot ? path.resolve(indexRoot) : null;
    const buildInfo = explicitIndexRoot
      ? null
      : getCurrentBuildInfo(root, userConfig, { mode: executionEmbedModes[0] || null });
    const baseIndexRoot = explicitIndexRoot || providedIndexRoot || null;
    const modeIndexRootCache = new Map();
    const resolveModeIndexRoot = (mode) => {
      if (modeIndexRootCache.has(mode)) {
        return modeIndexRootCache.get(mode);
      }
      const resolved = baseIndexRoot
        || (mode ? buildInfo?.buildRoots?.[mode] : null)
        || buildInfo?.buildRoot
        || null;
      modeIndexRootCache.set(mode, resolved);
      return resolved;
    };

    const lock = await acquireBuildIndexLock({ repoCacheRoot, log });
    try {
      throwIfAborted(abortSignal);
      const embedTotal = executionEmbedModes.length;
      let embedIndex = 0;
      const advanceEmbeddingsProgress = (modeName) => {
        if (includeEmbeddings && overallProgressRef?.current?.advance) {
          overallProgressRef.current.advance({ message: `${modeName} embeddings` });
        }
        if (!embedTotal) return;
        embedIndex += 1;
        showProgress('Embeddings', embedIndex, embedTotal, {
          stage: 'embeddings',
          message: modeName
        });
      };
      if (embedTotal) {
        showProgress('Embeddings', embedIndex, embedTotal, { stage: 'embeddings' });
      }

      const commonEmbeddingArgs = [];
      if (Number.isFinite(Number(argv.dims))) {
        commonEmbeddingArgs.push('--dims', String(argv.dims));
      }
      if (embeddingRuntime.useStubEmbeddings) commonEmbeddingArgs.push('--stub-embeddings');
      commonEmbeddingArgs.push('--progress', 'off');

      if (embeddingRuntime.embeddingService) {
        const queueDir = embeddingRuntime.queueDir
          ? path.resolve(embeddingRuntime.queueDir)
          : path.join(getCacheRoot(), 'service', 'queue');
        await ensureQueueDir(queueDir);
        const jobs = [];
        for (const modeItem of executionEmbedModes) {
          throwIfAborted(abortSignal);
          const modeIndexRoot = resolveModeIndexRoot(modeItem);
          const modeIndexDir = modeIndexRoot
            ? getIndexDir(root, modeItem, userConfig, { indexRoot: modeIndexRoot })
            : null;
          const jobId = crypto.randomUUID();
          const result = await enqueueJob(
            queueDir,
            {
              id: jobId,
              createdAt: new Date().toISOString(),
              repo: root,
              mode: modeItem,
              buildRoot: modeIndexRoot,
              indexDir: modeIndexDir,
              reason: 'stage3',
              stage: 'stage3'
            },
            embeddingRuntime.queueMaxQueued,
            'embeddings'
          );
          if (!result.ok) {
            log(`[embeddings] Queue full or unavailable; skipped enqueue (${modeItem}).`);
            advanceEmbeddingsProgress(modeItem);
            continue;
          }
          log(`[embeddings] Queued embedding job ${jobId} (${modeItem}).`);
          jobs.push(result.job || { id: jobId, mode: modeItem });
          advanceEmbeddingsProgress(modeItem);
        }
        return recordOk({ modes: embedModes, embeddings: { queued: true, jobs }, repo: root, stage: 'stage3' });
      }

      const runInlineEmbeddings = async ({ modeArg, indexRootArg, progressModes }) => {
        const args = [buildEmbeddingsPath, '--repo', root, '--mode', modeArg];
        if (indexRootArg) {
          args.push('--index-root', indexRootArg);
        }
        if (commonEmbeddingArgs.length) {
          args.push(...commonEmbeddingArgs);
        }
        const embedResult = await runEmbeddingsTool(args, {
          baseEnv: runtimeEnv,
          signal: abortSignal,
          onLine: (line) => {
            if (line.includes('lance::dataset::write::insert')
              || line.includes('No existing dataset at')) {
              return;
            }
            const match = fileProgressPattern.exec(line);
            if (match) {
              const mode = match[1];
              const current = Number(match[2]);
              const total = Number(match[3]);
              if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
                showProgress('Files', current, total, {
                  stage: 'embeddings',
                  mode,
                  taskId: `embeddings:${mode}:files`,
                  ephemeral: true
                });
              }
              logLine(line, { kind: 'status' });
              return;
            }
            if (line.startsWith('[embeddings]') || line.includes('embeddings]')) {
              logLine(line, { kind: 'status' });
              return;
            }
            logLine(line);
          }
        });
        if (embedResult?.cancelled) return embedResult;
        for (const modeName of progressModes) {
          advanceEmbeddingsProgress(modeName);
        }
        return embedResult;
      };

      const allModesRequested = areAllPrimaryModesRequested(executionEmbedModes);
      const uniqueIndexRoots = new Set();
      for (const modeItem of executionEmbedModes) {
        const modeIndexRoot = resolveModeIndexRoot(modeItem);
        if (typeof modeIndexRoot === 'string' && modeIndexRoot.length > 0) {
          uniqueIndexRoots.add(modeIndexRoot);
        }
      }
      const batchedRoot = uniqueIndexRoots.size === 1
        ? uniqueIndexRoots.values().next().value
        : null;
      const canBatchAllModes = allModesRequested && uniqueIndexRoots.size <= 1;
      const toCancelledInlineResult = (embedResult) => ({
        modes: embedModes,
        embeddings: {
          queued: false,
          inline: true,
          cancelled: true,
          code: embedResult.code ?? null,
          signal: embedResult.signal ?? null
        },
        repo: root,
        stage: 'stage3'
      });

      if (canBatchAllModes) {
        throwIfAborted(abortSignal);
        const embedResult = await runInlineEmbeddings({
          modeArg: 'all',
          indexRootArg: batchedRoot,
          progressModes: PRIMARY_INDEX_MODES
        });
        if (embedResult?.cancelled) {
          log('[embeddings] build-embeddings cancelled; skipping remaining modes.');
          return recordOk(toCancelledInlineResult(embedResult));
        }
      } else {
        for (const modeItem of executionEmbedModes) {
          throwIfAborted(abortSignal);
          const modeIndexRoot = resolveModeIndexRoot(modeItem);
          const embedResult = await runInlineEmbeddings({
            modeArg: modeItem,
            indexRootArg: modeIndexRoot,
            progressModes: [modeItem]
          });
          if (embedResult?.cancelled) {
            log('[embeddings] build-embeddings cancelled; skipping remaining modes.');
            return recordOk(toCancelledInlineResult(embedResult));
          }
        }
      }
      return recordOk({ modes: embedModes, embeddings: { queued: false, inline: true }, repo: root, stage: 'stage3' });
    } finally {
      await lock.release();
    }
  } catch (err) {
    if (isAbortError(err)) {
      recordIndexMetric('stage3', 'aborted', started);
      throw err;
    }
    recordIndexMetric('stage3', 'error', started);
    throw err;
  }
};
