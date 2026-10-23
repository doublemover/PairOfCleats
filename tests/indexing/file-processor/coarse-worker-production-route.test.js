import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createSchedulerQueueAdapter } from '../../../src/shared/concurrency/queue-adapter.js';
import { executeFileAnalysis } from '../../../src/index/build/workers/file-analysis-task.js';
import { fileAnalysisAdmissionBytes } from '../../../src/index/build/workers/file-analysis-contract.js';
import { createTokenizationBuffers, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createFileProcessorFixture, writeFixtureFile, createScannedFileEntry,
  createFileProcessorForTest } from './file-processor-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });
// AUTHORED, execution deferred until the shared source wave is frozen.
const fixture = await createFileProcessorFixture(`coarse-production-route-${process.pid}`);
const source = 'export function value(x) { return x + 1; }\n';
const file = await writeFixtureFile({ root: fixture.repoRoot, rel: 'value.ts', contents: source });
const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: fileAnalysisAdmissionBytes(file.stat.size) });
const cpu = createSchedulerQueueAdapter({ scheduler, queueName: 'file', tokens: { cpu: 1 }, concurrency: 1 });
const resources = { dictWords: new Set(), codeDictWords: new Set(), codeDictWordsByLanguage: new Map(), codeDictLanguages: null,
  backend: 'worker', tokenize: (row, context) => tokenizeChunkText({ ...row, context, buffers: createTokenizationBuffers() }) };
let dispatched = 0;
const tokenizationStats = {};
const workerPool = { config: { enabled: true }, shouldUseForFile: () => true, analyzeFile: async payload => {
  dispatched++;
  assert.equal(scheduler.stats().tokens.cpu.used, 1);
  assert.ok(scheduler.stats().activity.inFlightBytes >= fileAnalysisAdmissionBytes(file.stat.size));
  return executeFileAnalysis(payload, resources);
} };
const make = overrides => createFileProcessorForTest({ root: fixture.repoRoot,
  languageOptions: { treeSitter: { enabled: false } }, overrides });
const entry = createScannedFileEntry({ abs: file.targetPath, rel: file.rel, stat: file.stat });
try {
  const expected = await make({ queues: { cpu }, tokenizationStats: {} }).processFile(entry, 0);
  const actual = await make({ queues: { cpu }, workerPool, tokenizationStats }).processFile(entry, 0);
  // Timing observations use wall clocks; compare the persistent file/chunk facts.
  for (const key of ['chunks', 'fileRelations', 'fileInfo', 'parseCheckpoint', 'lexicalCheckpoint']) {
    assert.deepEqual(actual?.[key], expected?.[key], key);
  }
  assert.ok(actual?.chunks?.length > 0);
  assert.equal(dispatched, 1, 'real outer file processor dispatches the bounded analysis contract');
  assert.equal(tokenizationStats.coarseAnalysis.completed, 1);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  const automatic = { ...workerPool, config: { enabled: 'auto' }, shouldUseForFile: () => false };
  await make({ queues: { cpu }, workerPool: automatic, tokenizationStats: {} }).processFile(entry, 0);
  assert.equal(dispatched, 1, 'ordinary auto/default routing has no coarse adoption claim');
} finally { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
console.log('outer file processor reserves and consumes bounded opt-in coarse analysis');
