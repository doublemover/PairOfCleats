import { once } from 'node:events';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';

export const BACKEND_CHILD_RECORD_PREFIX = '\u001ePOC_ANN:';
const MAX_REQUEST_BYTES = 64 * 1024;
const variants = new Set(['merged', 'doc', 'code']);

const emit = async record => {
  if (!process.stdout.write(BACKEND_CHILD_RECORD_PREFIX + JSON.stringify(record) + '\n')) await once(process.stdout, 'drain');
};

/** One invocation owns at most three sequential native jobs. Native modules
 * initialize once; no child or served native handle survives this invocation. */
export const runBackendChild = async () => {
  await requireBootstrap();
  const parts = []; let bytes = 0;
  for await (const part of process.stdin) {
    bytes += part.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error('ANN child request exceeds its byte allowance.');
    parts.push(part);
  }
  const request = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!['hnsw', 'lancedb'].includes(request.backend) || !Array.isArray(request.jobs)
    || request.jobs.length < 1 || request.jobs.length > 3 || new Set(request.jobs.map(job => job.target)).size !== request.jobs.length
    || request.jobs.some(job => !variants.has(job.target) || !job.payload || Object.hasOwn(job.payload, 'vectors')
      || typeof job.payload.vectorsPath !== 'string')) throw new Error('Invalid bounded ANN child job inventory.');
  const module = request.backend === 'hnsw' ? await import('./hnsw.js') : await import('./lancedb.js');
  for (const job of request.jobs) {
    await emit({ type: 'start', target: job.target });
    try {
      const result = request.backend === 'hnsw'
        ? await module.writeHnswIndex({ ...job.payload, isolate: false, skipIsolate: true })
        : await module.writeLanceDbIndex({ ...job.payload, emitOutput: false, skipIsolate: true });
      await emit({ type: 'result', target: job.target, result });
    } catch (error) {
      await emit({ type: 'result', target: job.target, result: { skipped: true, reason: 'writer failed',
        error: { code: error.code || null, message: String(error.message || error).slice(0, 8192),
          ...(error.diagnosticEvidence ? { diagnosticEvidence: error.diagnosticEvidence } : {}) } } });
    }
  }
};
