import path from 'node:path';
import { getCacheRoot } from '../../../../tools/dict-utils.js';
import { log } from '../../../shared/progress.js';
import { ensureQueueDir, enqueueJob } from '../../../../tools/service/queue.js';

export const enqueueEmbeddingJob = async ({ runtime, mode }) => {
  if (!runtime.embeddingService) return null;
  const queueDir = runtime.embeddingQueue?.dir
    ? path.resolve(runtime.embeddingQueue.dir)
    : path.join(getCacheRoot(), 'service', 'queue');
  const maxQueued = Number.isFinite(runtime.embeddingQueue?.maxQueued)
    ? runtime.embeddingQueue.maxQueued
    : null;
  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  await ensureQueueDir(queueDir);
  const result = await enqueueJob(
    queueDir,
    {
      id: jobId,
      createdAt: new Date().toISOString(),
      repo: runtime.root,
      mode,
      reason: 'embeddings'
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
};
