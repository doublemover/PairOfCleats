import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const readJson = async (filePath, fallback) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const withLock = async (lockPath, worker) => {
  const start = Date.now();
  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        return await worker();
      } finally {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      }
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      if (Date.now() - start > 5000) throw new Error('Queue lock timeout.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
};

export async function ensureQueueDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function getQueuePaths(dirPath) {
  return {
    queuePath: path.join(dirPath, 'queue.json'),
    lockPath: path.join(dirPath, 'queue.lock')
  };
}

export async function loadQueue(dirPath) {
  const { queuePath } = getQueuePaths(dirPath);
  const payload = await readJson(queuePath, { jobs: [] });
  return {
    jobs: Array.isArray(payload.jobs) ? payload.jobs : []
  };
}

export async function saveQueue(dirPath, queue) {
  const { queuePath } = getQueuePaths(dirPath);
  await fs.writeFile(queuePath, JSON.stringify(queue, null, 2));
}

export async function enqueueJob(dirPath, job, maxQueued = null) {
  await ensureQueueDir(dirPath);
  const { lockPath } = getQueuePaths(dirPath);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath);
    const queued = queue.jobs.filter((entry) => entry.status === 'queued');
    if (Number.isFinite(maxQueued) && queued.length >= maxQueued) {
      return { ok: false, message: 'Queue is full.' };
    }
    const next = {
      id: job.id,
      createdAt: job.createdAt,
      status: 'queued',
      repo: job.repo,
      mode: job.mode,
      reason: job.reason || null
    };
    queue.jobs.push(next);
    await saveQueue(dirPath, queue);
    return { ok: true, job: next };
  });
}

export async function claimNextJob(dirPath) {
  const { lockPath } = getQueuePaths(dirPath);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath);
    const job = queue.jobs.find((entry) => entry.status === 'queued');
    if (!job) return null;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    await saveQueue(dirPath, queue);
    return job;
  });
}

export async function completeJob(dirPath, jobId, status, result) {
  const { lockPath } = getQueuePaths(dirPath);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath);
    const job = queue.jobs.find((entry) => entry.id === jobId);
    if (!job) return null;
    job.status = status;
    job.finishedAt = new Date().toISOString();
    job.result = result || null;
    await saveQueue(dirPath, queue);
    return job;
  });
}

export async function queueSummary(dirPath) {
  if (!fsSync.existsSync(dirPath)) {
    return { total: 0, queued: 0, running: 0, done: 0, failed: 0 };
  }
  const queue = await loadQueue(dirPath);
  const summary = { total: queue.jobs.length, queued: 0, running: 0, done: 0, failed: 0 };
  for (const job of queue.jobs) {
    if (job.status === 'queued') summary.queued += 1;
    else if (job.status === 'running') summary.running += 1;
    else if (job.status === 'done') summary.done += 1;
    else if (job.status === 'failed') summary.failed += 1;
  }
  return summary;
}
