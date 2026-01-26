import crypto from 'node:crypto';
import path from 'node:path';
import { getCacheRoot } from '../../../../tools/dict-utils.js';
import { log } from '../../../shared/progress.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { ensureQueueDir, enqueueJob } from '../../../../tools/service/queue.js';

export const enqueueEmbeddingJob = async ({ runtime, mode, indexRoot = null, abortSignal = null }) => {
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
    await ensureQueueDir(queueDir);
    throwIfAborted(abortSignal);
    const result = await enqueueJob(
      queueDir,
      {
        id: jobId,
        createdAt: new Date().toISOString(),
        repo: runtime.root,
        mode,
        reason: 'embeddings',
        buildId: runtime.buildId || null,
        buildRoot: runtime.buildRoot || null,
        indexRoot: indexRoot ? path.resolve(indexRoot) : null,
        embeddingIdentity: runtime.embeddingIdentity || null,
        embeddingIdentityKey: runtime.embeddingIdentityKey || null,
        embeddingPayloadFormatVersion: 1
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
