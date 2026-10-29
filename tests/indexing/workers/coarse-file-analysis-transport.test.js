import assert from 'node:assert/strict';
import path from 'node:path';
import Piscina from 'piscina';
import { fileURLToPath } from 'node:url';
import { IndexerProcessPool, createProcessMemoryAccount } from '../../../src/index/build/workers/process-pool.js';
import { IndexerThreadPool } from '../../../src/index/build/workers/thread-pool.js';
import { awaitWithKeepalive } from '../../../src/shared/promise-keepalive.js';
import { projectFileAnalysisInput, decodeFileAnalysisResult } from '../../../src/index/build/workers/file-analysis-contract.js';
import { executeFileAnalysis } from '../../../src/index/build/workers/file-analysis-task.js';
import { createTokenizationBuffers, createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createScmFileProcessorContext } from '../file-processor/scm-file-processor-test-helper.js';

// AUTHORED real Worker/process controls; no runtime/native execution in this wave.
const backend = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'worker';
const text = 'export function view(x: number): number { if (x) return x + 1; return 0; }\n';
const dictionaries = { dictWords: [], codeDictWords: [], dictConfig: {}, postingsConfig: {} };
const input = createScmFileProcessorContext({ abs: path.join(process.cwd(), 'transport.ts'), ext: '.ts',
  rel: 'transport.ts', relKey: 'transport.ts', text, fileStat: { size: Buffer.byteLength(text) },
  scmProvider: null, scmProviderImpl: null, relationsEnabled: true, lintEnabled: true, complexityEnabled: true,
  tokenContext: createTokenizationContext({ dictWords: new Set(), dictConfig: {}, postingsConfig: {} }) });
const { payload } = projectFileAnalysisInput(input);
assert.ok(payload);
const expected = decodeFileAnalysisResult(payload, await executeFileAnalysis(payload, { dictWords: new Set(),
  codeDictWords: new Set(), codeDictWordsByLanguage: new Map(), codeDictLanguages: null, backend,
  tokenize: (row, context) => tokenizeChunkText({ ...row, context, buffers: createTokenizationBuffers() }) }));
const account = createProcessMemoryAccount(process.memoryUsage().rss + 512 * 1024 * 1024);
const pool = backend === 'process'
  ? new IndexerProcessPool({ maxThreads: 1, oldSpaceMb: 256, workerData: dictionaries,
    taskTimeout: 10000, budgetAccount: account })
  : new IndexerThreadPool(new Piscina({ filename: fileURLToPath(new URL('../../../src/index/build/workers/indexer-worker.js', import.meta.url)),
    minThreads: 1, maxThreads: 1, concurrentTasksPerWorker: 1, workerData: dictionaries,
    atomics: 'async', resourceLimits: { maxOldGenerationSizeMb: 256 } }));
let observedCompletion;
const completion = new Promise(resolve => { observedCompletion = resolve; });
const observations = [];
pool.on('message', message => {
  observations.push(message);
  if (message.type === 'worker-task' && message.task === 'analyze' && message.status === 'ok') observedCompletion(message);
});
try {
  const receipt = await pool.run(payload, { name: 'analyzeFile' });
  const actual = decodeFileAnalysisResult(payload, receipt);
  assert.equal(actual.status, 'completed');
  assert.deepEqual(actual.result, expected.result, `${backend} keeps full canonical file projections`);
  assert.equal(receipt.identity, payload.identity);
  assert.equal(receipt.outputBytes, receipt.body.byteLength);
  const observed = await awaitWithKeepalive(completion);
  assert.equal(observed.task, 'analyze'); assert.equal(observed.status, 'ok');
  assert.ok(Number.isFinite(observed.durationMs));
  assert.ok(observations.some(message => message.type === 'worker-task-start' && message.task === 'analyze'));
  if (backend === 'process') {
    assert.equal(pool.stats().staleResults, 0, 'healthy startup observations are distinct from stale authoritative task results');
    assert.equal(pool.stats().completed, 1);
    assert.equal(pool.stats().ipcReservedBytes, 0);
    assert.ok(pool.stats().peakIpcReservedBytes >= 16 * 1024 * 1024,
      'full bounded output is reserved even for small inputs');
  }
} finally { await pool.destroy(); }
if (backend === 'process') assert.equal(account.stats().reservedBytes, 0, 'destroy confirms child capacity settlement');
console.log(`${backend} transports bounded canonical coarse file results`);
