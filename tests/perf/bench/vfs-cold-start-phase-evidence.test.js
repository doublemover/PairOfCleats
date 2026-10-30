import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { admitVfsColdStartWork, buildVfsColdStartPlan, runVfsColdStartSample } from '../../../tools/bench/vfs/cold-start-sample.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const plan = await buildVfsColdStartPlan({ docs: 3, docBytes: 8 });
assert.equal(plan.identity.actualUtf8Bytes, 24);
assert.ok(plan.documents.every(value => Buffer.byteLength(value.text) === 8));
const disk = new Map(), memory = new Map(), persisted = new Map();
let loadState = 'loaded', cacheCalls = 0;
const createCache = async ({ cacheRoot }) => {
  cacheCalls++;
  const initial = loadState === 'loaded' ? new Map(persisted.get(cacheRoot) || []) : new Map();
  const entries = new Map(initial); let flushes = 0, dirty = false;
  return { get: ({ virtualPath }) => entries.get(virtualPath)?.diskPath || null,
    set: value => { entries.set(value.virtualPath, value); dirty = true; },
    flush: async () => { if (dirty) { flushes++; persisted.set(cacheRoot, new Map(entries)); dirty = false; } },
    stats: () => ({ loadedEntries: initial.size, loadedInputBytes: initial.size * 200,
      loadStatus: initial.size ? 'loaded' : loadState === 'loaded' ? 'missing' : loadState, flushes }) };
};
const ensureDocument = async ({ baseDir, virtualPath, text, coldStartCache, docHash }) => {
  const target = path.resolve(baseDir, virtualPath), sha256 = createHash('sha256').update(text).digest('hex');
  const candidate = coldStartCache?.get({ virtualPath }), prior = memory.get(target), existing = disk.get(target);
  const same = existing?.equals(Buffer.from(text)) === true;
  const source = same ? prior === sha256 ? 'memory' : candidate === target ? 'cold-start' : 'existing-verified' : 'created';
  if (!same) disk.set(target, Buffer.from(text)); memory.set(target, sha256);
  coldStartCache?.set({ virtualPath, docHash, diskPath: target, sizeBytes: Buffer.byteLength(text) });
  return { path: target, cacheHit: same, source, materialization: { sha256, sizeBytes: Buffer.byteLength(text),
    verificationBytes: source === 'memory' ? 0 : Buffer.byteLength(text) } };
};
const controls = { createCache, ensureDocument, readFile: async file => Buffer.from(disk.get(file)) };
for (let sample = 0; sample < 3; sample++) {
  const rootDir = path.resolve('.tmp', 'vfs-phase-control', `sample-${sample}`);
  const cold = await runVfsColdStartSample({ mode: 'cold', rootDir, plan }, controls);
  assert.equal(cold.state, 'qualified-phase'); assert.equal(cold.counts.created, 3); assert.equal(cold.counts.persistedHits, 0);
  assert.equal(cold.finalCache.flushes, 1); assert.equal(cold.consumerParity.bytes, 24);
  memory.clear();
  const warm = await runVfsColdStartSample({ mode: 'warm', rootDir, plan }, controls);
  assert.equal(warm.state, 'qualified-phase'); assert.equal(warm.initialCache.loadedEntries, 3);
  assert.equal(warm.counts.persistedHits, 3); assert.equal(warm.counts.created, 0); assert.equal(warm.finalCache.flushes, 1);
  assert.equal(warm.phases.totalMs, warm.phases.cacheLoadMs + warm.phases.documentAccessMs + warm.phases.flushMs);
  memory.clear(); const calls = cacheCalls;
  const hot = await runVfsColdStartSample({ mode: 'hot', rootDir, plan }, controls);
  assert.equal(cacheCalls, calls, 'hot access does not hide persisted-cache work in its measurement');
  assert.equal(hot.state, 'qualified-phase'); assert.equal(hot.counts.memoryHits, 3);
  assert.equal(hot.warmup.documents, 3); assert.equal(hot.phases.cacheLoadMs, 0); assert.equal(hot.phases.flushMs, 0);
  assert.equal(hot.counts.contentVerificationBytes, 0); assert.equal(hot.consumerParity.sha256, warm.consumerParity.sha256);
  for (const state of ['missing', 'stale-source', 'rejected-input']) {
    memory.clear(); loadState = state;
    const miss = await runVfsColdStartSample({ mode: 'warm', rootDir, plan }, controls);
    assert.equal(miss.state, 'unqualified-phase'); assert.equal(miss.counts.persistedHits, 0);
    assert.equal(miss.counts.existingVerified, 3); assert.equal(miss.initialCache.loadStatus, state);
    assert.ok(miss.reasons.includes('persisted-admission-or-hit-coverage-incomplete'));
  }
  loadState = 'loaded';
  const repeatedCold = await runVfsColdStartSample({ mode: 'cold', rootDir, plan }, controls);
  assert.equal(repeatedCold.state, 'unqualified-phase', 'reusing a root cannot masquerade as another cold repetition');
  await assert.rejects(runVfsColdStartSample({ mode: 'warm', rootDir, plan }, {
    ...controls, readFile: async () => Buffer.alloc(8)
  }), /consumer read different bytes/u);
}
for (const changed of [{ docs: 0 }, { docBytes: 7 }, { samples: 1.5 }, { docs: 50001 }, { docBytes: Infinity }]) {
  assert.throws(() => admitVfsColdStartWork({ docs: 3, docBytes: 8, samples: 1, ...changed }), RangeError);
}
console.log('VFS phase receipts qualify actual materialization, persisted admission and hot access with matching persistence and content.');
