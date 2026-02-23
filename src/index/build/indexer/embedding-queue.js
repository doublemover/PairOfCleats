import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCacheRoot } from '../../../shared/dict-utils.js';
import { log } from '../../../shared/progress.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { ensureQueueDir, enqueueJob } from '../../../shared/queue.js';
import { isAbsolutePathNative } from '../../../shared/files.js';

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
      ? runtime.embeddingQueue.maxQueued
      : 10;
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
    if (!rel || rel.startsWith('..') || isAbsolutePathNative(rel)) {
      throw new Error(`Embedding job indexDir must live under buildRoot (${resolvedIndexDir}).`);
    }
    await ensureQueueDir(queueDir);
    throwIfAborted(abortSignal);
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
        embeddingPayloadFormatVersion: 2
      },
      maxQueued,
      'embeddings'
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
