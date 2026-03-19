import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCacheRoot } from '../../../shared/dict-utils.js';
import { log } from '../../../shared/progress.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { ensureQueueDir, enqueueJob } from '../../../shared/queue.js';
import { isAbsolutePathNative, isRelativePathEscape } from '../../../shared/files.js';
import {
  resolveQueueAdmissionPolicy,
  resolveQueueSloPolicy
} from '../../../../tools/service/admission-policy.js';

const DEFAULT_EMBEDDING_QUEUE_MAX_QUEUED = 10;
const EMBEDDING_QUEUE_JOB_COST_UNITS = 4;

/**
 * Enqueue stage3 embedding job for asynchronous embedding service processing.
 *
 * @param {{
 *  runtime:object,
 *  mode:string,
 *  indexDir?:string|null,
 *  indexRoot?:string|null,
 *  abortSignal?:AbortSignal|null
 * }} input
 * @returns {Promise<object|null>}
 */
export const enqueueEmbeddingJob = async ({
  runtime,
  mode,
  indexDir = null,
  indexRoot = null,
  abortSignal = null
}) => {
  if (!runtime.embeddingService) return null;
  throwIfAborted(abortSignal);
  try {
    const queueDir = runtime.embeddingQueue?.dir
      ? path.resolve(runtime.embeddingQueue.dir)
      : path.join(getCacheRoot(), 'service', 'queue');
    const maxQueued = Number.isFinite(runtime.embeddingQueue?.maxQueued)
      ? Math.max(0, Math.floor(Number(runtime.embeddingQueue.maxQueued)))
      : DEFAULT_EMBEDDING_QUEUE_MAX_QUEUED;
    const jobId = crypto.randomUUID();
    const repoRoot = runtime.root ? path.resolve(runtime.root) : null;
    const buildRoot = runtime.buildRoot ? path.resolve(runtime.buildRoot) : null;
    const resolvedIndexDir = indexDir ? path.resolve(indexDir) : (indexRoot ? path.resolve(indexRoot) : null);
    if (!buildRoot) {
      throw new Error('Embedding job enqueue requires runtime.buildRoot.');
    }
    if (!resolvedIndexDir) {
      throw new Error('Embedding job enqueue requires indexDir.');
    }
    if (!fs.existsSync(buildRoot)) {
      throw new Error(`Embedding job buildRoot missing: ${buildRoot}`);
    }
    if (!fs.existsSync(resolvedIndexDir)) {
      throw new Error(`Embedding job indexDir missing: ${resolvedIndexDir}`);
    }
    const rel = path.relative(buildRoot, resolvedIndexDir);
    if (isRelativePathEscape(rel) || isAbsolutePathNative(rel)) {
      throw new Error(`Embedding job indexDir must live under buildRoot (${resolvedIndexDir}).`);
    }
    await ensureQueueDir(queueDir);
    throwIfAborted(abortSignal);
    const queueConfig = {
      maxQueued,
      resourceBudgetUnits: Math.max(1, maxQueued + 1) * EMBEDDING_QUEUE_JOB_COST_UNITS
    };
    const result = await enqueueJob(
      queueDir,
      {
        id: jobId,
        createdAt: new Date().toISOString(),
        repo: repoRoot,
        repoRoot,
        mode,
        reason: 'embeddings',
        buildId: runtime.buildId || null,
        buildRoot,
        indexDir: resolvedIndexDir,
        indexRoot: indexRoot ? path.resolve(indexRoot) : null,
        configHash: runtime.configHash || null,
        repoProvenance: runtime.repoProvenance || null,
        embeddingIdentity: runtime.embeddingIdentity || null,
        embeddingIdentityKey: runtime.embeddingIdentityKey || null,
        embeddingPayloadFormatVersion: 2,
        idempotencyKey: `embq1:${jobId}`
      },
      maxQueued,
      'embeddings',
      {
        admissionPolicy: resolveQueueAdmissionPolicy({
          queueName: 'embeddings',
          queueConfig
        }),
        sloPolicy: resolveQueueSloPolicy({
          queueName: 'embeddings',
          queueConfig
        })
      }
    );
    if (!result.ok) {
      log('[embeddings] Queue full or unavailable; skipped enqueue.');
      return null;
    }
    log(`[embeddings] Queued embedding job ${jobId} (${mode}).`);
    return result.job || null;
  } catch (err) {
    log(`[embeddings] Queue enqueue failed; skipped (${err?.message || err}).`);
    return null;
  }
};
