import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCrossFileWorkReporter } from '../../../../src/index/build/build-state/cross-file.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-crossfile-progress-'));
const fresh = () => Array.from({ length: 180 }, (_, i) => ({ file: 'fixture.js', name: `item${i}`,
  chunkUid: `item${i}`, start: i, end: i + 1, codeRelations: {}, docmeta: {} }));
const patches = [];
const reporter = createCrossFileWorkReporter({ buildRoot: root, buildId: 'generation-a', mode: 'code',
  now: () => '2026-10-22T00:00:00.000Z', write: async (buildRoot, patch) => {
    assert.equal(buildRoot, root); patches.push(structuredClone(patch));
  } });
const run = options => applyCrossFileInference({ rootDir: root, chunks: fresh(), enabled: true,
  cacheEnabled: false, enableTypeInference: false, ...options });
try {
  await run({ onProgress: reporter });
  assert.ok(patches.length >= 3, 'start, awaited bundle progress and terminal computation receipts');
  const entries = patches.map(patch => patch.phases['cross-file:code']);
  assert.equal(entries[0].detail.observedCompletedChunks, 0);
  assert.equal(entries.at(-1).status, 'done');
  assert.equal(entries.at(-1).detail.observedCompletedChunks, 180);
  for (const entry of entries) {
    assert.equal(entry.detail.durableCompletedChunks, 0, 'mutable effects never become a sealed prefix');
    assert.equal(entry.detail.resume.strategy, 'restart-phase');
    assert.equal(entry.detail.resume.sealedOutput, false);
    assert.equal(entry.detail.publication, 'pending');
    assert.equal(entry.detail.analysisCoverage, 'unknown');
  }
  assert.ok(patches.every(patch => !Object.hasOwn(patch, 'currentPhase')), 'do not replace enclosing phase authority');
  await assert.rejects(reporter({ status: 'running', fingerprint: '0'.repeat(40), totalChunks: 180,
    observedCompletedChunks: 1 }), { code: 'ERR_CROSS_FILE_PROGRESS' }, 'source generation and progress cannot regress');
  const startFailure = new Error('start receipt failed');
  const input = fresh(), before = structuredClone(input);
  await assert.rejects(run({ chunks: input, onProgress: async () => { throw startFailure; } }), error => error === startFailure);
  assert.deepEqual(input, before, 'required start failure occurs before mutable propagation');

  const controller = new AbortController(), canceled = [];
  await assert.rejects(run({ abortSignal: controller.signal, onProgress: async event => {
    canceled.push(structuredClone(event));
    if (event.status === 'running' && event.observedCompletedChunks > 0) controller.abort();
  } }), { name: 'AbortError' });
  assert.equal(canceled.at(-1).status, 'failed');
  assert.equal(canceled.at(-1).canceled, true);
  assert.ok(canceled.at(-1).observedCompletedChunks > 0);
  const primary = new Error('progress storage failed'), secondary = new Error('failure receipt failed');
  await assert.rejects(run({ onProgress: async event => {
    if (event.status === 'failed') throw secondary;
    if (event.observedCompletedChunks > 0) throw primary;
  } }), error => error === primary && error.checkpointError === secondary,
  'failure recording cannot replace the original propagation/checkpoint error');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Durable cross-file work receipts, phase restart and primary-error ownership controls passed.');
