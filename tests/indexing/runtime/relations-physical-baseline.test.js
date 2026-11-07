import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { scheduleRelationsPhysicalBaseline } from '../../../src/index/build/indexer/steps/relations/physical-baseline.js';

const scheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1, maxInFlightBytes: 64 });
const runtime = { scheduler, buildId: 'relations-fixture', buildRoot: 'task-owned-build-fixture', configHash: 'c'.repeat(64) };
const patches = [];
const write = async (root, patch) => { assert.equal(root, runtime.buildRoot); patches.push(structuredClone(patch)); };
const invoke = options => scheduleRelationsPhysicalBaseline({ runtime, mode: 'code', stage: 'propagate',
  chunks: 2, files: 1, write, ...options });
try {
  let runs = 0;
  const result = await invoke({ run: async () => { runs++; return 'existing-result'; } });
  assert.equal(result, 'existing-result'); assert.equal(runs, 1);
  const entries = patches.map(patch => patch.phases['relations-physical:code:propagate']);
  assert.equal(entries[0].status, 'running'); assert.equal(entries.at(-1).status, 'done');
  const receipt = entries.at(-1).detail;
  assert.equal(receipt.prediction, 'unavailable-no-calibration');
  assert.equal(receipt.hardwareQualification, 'unmeasured');
  assert.equal(receipt.execution.effectiveImplementation, 'builtin-relations-propagate/v1');
  assert.equal(receipt.execution.predictedMilliseconds, null);
  assert.deepEqual(receipt.execution.reservation, { cpu: 1, io: 0, mem: 1, bytes: 0 });
  assert.equal(receipt.publication, 'pending'); assert.equal(receipt.semanticCoverage, 'not-implied');
  assert.ok(patches.every(patch => !Object.hasOwn(patch, 'currentPhase')));
  const denied = new Error('required start receipt failed');
  await assert.rejects(invoke({ run: () => { throw new Error('must not run'); }, write: async () => { throw denied; } }),
    error => error === denied);

  const controller = new AbortController(), cancellation = [];
  let begin, finish;
  const started = new Promise(resolve => { begin = resolve; });
  const completion = new Promise(resolve => { finish = resolve; });
  const operation = invoke({ signal: controller.signal, run: () => { begin(); return completion; },
    write: async (root, patch) => { cancellation.push(structuredClone(patch)); } });
  const failed = assert.rejects(operation, { name: 'AbortError' });
  await started; controller.abort();
  assert.equal(cancellation.length, 1, 'abort request alone cannot record a settled physical execution');
  finish('actual-cleanup-finished'); await failed;
  assert.equal(cancellation.at(-1).phases['relations-physical:code:propagate'].status, 'failed');
  assert.equal(cancellation.at(-1).phases['relations-physical:code:propagate'].detail.canceled, true);

  const primary = new Error('operation failed'), secondary = new Error('failure receipt failed');
  await assert.rejects(invoke({ run: () => { throw primary; }, write: async (root, patch) => {
    if (patch.phases['relations-physical:code:propagate'].status === 'failed') throw secondary;
  } }), error => error === primary && error.checkpointError === secondary);
} finally { await scheduler.shutdown({ awaitRunning: true }); }
console.log('actual relations baseline, required work receipts and execution-fence controls passed');
