import assert from 'node:assert/strict';
import path from 'node:path';
import { createOnnxQualificationBinding, createOnnxQualificationLease, acquireOnnxQualificationSlot,
  closeOnnxQualificationLease, sealOnnxMemoryEvidence } from '../../../src/shared/onnx-embeddings/qualification.js';
const modelArtifact = { status: 'verified', reuse: 'allow', digest: 'a'.repeat(64) };
const modelPath = path.resolve('controlled-qualification-fixture.onnx');
const memory = { totalBytes: 1024 ** 3, freeBytes: 512 * 1024 ** 2, constrainedBytes: null, configuredLimitBytes: null };
const single = { sessions: 1, intraOpNumThreads: 1, interOpNumThreads: 1,
  graphOptimizationLevel: 'basic', enableCpuMemArena: false, enableMemPattern: false };
const { sessions: ignored, ...settings } = single; void ignored;
const bind = overrides => createOnnxQualificationBinding({ modelArtifact, modelPath, cpuBudget: 4, memory,
  sessionSettings: settings, processing: { normalize: true }, workload: { digest: 'fixture' }, ...overrides });
const binding = bind(), native = { modelArtifact, modelPath, lowMemory: false, processing: { normalize: true } };
const lease = createOnnxQualificationLease({ binding, candidate: single, memory });
const first = acquireOnnxQualificationSlot(lease, native);
assert.equal(first.options.intraOpNumThreads, 1);
assert.throws(() => acquireOnnxQualificationSlot(lease, native), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
assert.throws(() => closeOnnxQualificationLease(lease), error => error.cacheOwnershipPending === true);
first.release(); first.release(); closeOnnxQualificationLease(lease);
assert.throws(() => acquireOnnxQualificationSlot(lease, native), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
assert.throws(() => acquireOnnxQualificationSlot({ ...lease }, native), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
for (const candidate of [{ ...single, intraOpNumThreads: 5 }, { ...single, interOpNumThreads: 2 },
  { ...single, sessions: 3 }, { ...single, graphOptimizationLevel: 'unknown' },
  { ...single, enableCpuMemArena: 'true' }]) {
  assert.throws(() => createOnnxQualificationLease({ binding, candidate, memory }), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
}
assert.throws(() => createOnnxQualificationLease({ binding: bind({ cpuBudget: 1 }), candidate: { ...single, sessions: 2 }, memory }), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
assert.throws(() => createOnnxQualificationLease({ binding, candidate: { ...single, sessions: 2 }, memory }), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
// Synthetic receipt exercises admission only; it is not native memory evidence.
const at = Date.now(), evidence = sealOnnxMemoryEvidence({ binding, measuredSessionBytes: 16 * 1024 ** 2, completedAt: new Date(at).toISOString() });
const pool = createOnnxQualificationLease({ binding, candidate: { ...single, sessions: 2 }, memory, memoryEvidence: evidence, now: at });
const a = acquireOnnxQualificationSlot(pool, native), b = acquireOnnxQualificationSlot(pool, native);
assert.notEqual(a.sessionKey, b.sessionKey, 'the pool cannot alias both adapters to one cached native session');
a.release(); b.release(); closeOnnxQualificationLease(pool);
for (const override of [
  { now: at + 31 * 60 * 1000 }, { memory: { ...memory, freeBytes: 32 * 1024 ** 2 } },
  { binding: bind({ cpuBudget: 3 }) }, { binding: bind({ workload: { digest: 'different-input' } }) },
  { memoryEvidence: { ...evidence, measuredSessionBytes: 1 } },
  { memoryEvidence: { ...evidence, disposalConfirmed: false } }
]) assert.throws(() => createOnnxQualificationLease({ binding, candidate: { ...single, sessions: 2 }, memory,
  memoryEvidence: evidence, now: at, ...override }), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
const changedModel = createOnnxQualificationLease({ binding, candidate: single, memory });
for (const processing of [null, { normalize: false }, { normalize: true, pooling: 'cls' }]) {
  assert.throws(() => acquireOnnxQualificationSlot(changedModel, { ...native, processing }), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
}
assert.throws(() => acquireOnnxQualificationSlot(changedModel, { ...native, modelArtifact: { ...modelArtifact, digest: 'b'.repeat(64) } }), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
closeOnnxQualificationLease(changedModel);
for (const field of ['enableCpuMemArena', 'enableMemPattern', 'graphOptimizationLevel']) {
  const candidate = { ...single, [field]: field === 'graphOptimizationLevel' ? 'all' : true };
  const { sessions, ...sessionSettings } = candidate; void sessions;
  const selected = createOnnxQualificationLease({ binding: bind({ sessionSettings }), candidate, memory });
  assert.throws(() => acquireOnnxQualificationSlot(selected, { ...native, lowMemory: true }), { code: 'ERR_ONNX_QUALIFICATION_PROFILE' });
  closeOnnxQualificationLease(selected);
}
console.log('ONNX experimental CPU/memory, identity and settlement capability assertions complete');
