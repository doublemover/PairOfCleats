import assert from 'node:assert/strict';
import path from 'node:path';
import { createIndexerWorkerPool } from '../../../src/index/build/workers/pool.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { fileAnalysisAdmissionBytes } from '../../../src/index/build/workers/file-analysis-contract.js';
import { processFileCpuWithWorker } from '../../../src/index/build/file-processor/coarse-worker.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { createScmFileProcessorContext } from '../file-processor/scm-file-processor-test-helper.js';

const backend = process.argv.at(-1);
const text = 'export function increment(x: number): number { return x + 1; }\n';
const dictWords = new Set();
const pool = await createIndexerWorkerPool({ config: { enabled: true, processFallback: true, maxWorkers: 1,
  heapTargetMb: 256, heapMinMb: 256, heapMaxMb: 256, taskTimeoutMs: 10000 },
dictWords, dictConfig: {}, postingsConfig: {}, memoryPolicy: { maxGlobalRssMb: 1024 }, log() {} });
assert.ok(pool, `${backend} facade requires real execution`);
assert.equal(pool.stats().backend, backend);
const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: fileAnalysisAdmissionBytes(Buffer.byteLength(text)) });
process.once('SIGTERM', () => { void pool.destroy().finally(() => process.exit(1)); });
const make = workerPool => createScmFileProcessorContext({ abs: path.resolve('facade.ts'), ext: '.ts', rel: 'facade.ts',
  relKey: 'facade.ts', text, fileStat: { size: Buffer.byteLength(text) }, scmProvider: null, scmProviderImpl: null,
  tokenizationStats: {}, tokenContext: createTokenizationContext({ dictWords, dictConfig: {}, postingsConfig: {} }),
  relationsEnabled: true, lintEnabled: true, complexityEnabled: true, workerPool });
try {
  const expected = await processFileCpu(make(null));
  const context = make(pool);
  const actual = await scheduler.schedule('file', { cpu: 1, bytes: fileAnalysisAdmissionBytes(Buffer.byteLength(text)) },
    () => processFileCpuWithWorker(context));
  assert.deepEqual(actual, expected);
  assert.equal(context.tokenizationStats.coarseAnalysis.completed, 1);
  assert.equal(pool.stats().activeTasks, 0);
  assert.equal(pool.stats().waitingForThrottle, 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  const observations = pool.stats().runtimeObservations;
  assert.ok(observations.some(entry => entry.resourceLimitAcknowledged === true));
  console.log(JSON.stringify({ backend, completed: context.tokenizationStats.coarseAnalysis.completed }));
} finally {
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
  await pool.destroy();
}
