import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withBakeoffCheckpoint } from '../../../tools/bench/embeddings/bakeoff-checkpoint.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = process.cwd(), { dir } = await prepareTestCacheDir('embedding-bakeoff-checkpoint-owner');
const checkpointPath = path.join(dir, 'checkpoint.json'), receiptRoot = path.join(dir, 'receipts');
const settings = { models: ['fixture-model'], mode: 'code', sampling: { maxFiles: 0, seed: 'fixture' } };
const options = { root, checkpointPath, receiptRoot, settings };
const payload = (status = 'running') => ({ generatedAt: '2026-10-26T12:00:00.000Z', settings,
  progress: { status, totalModels: 1, completedModels: status === 'completed' ? 1 : 0, resumedModels: 0 },
  models: status === 'completed' ? [{ modelId: 'fixture-model', fixture: true }] : [] });
const contains = (error, target, seen = new Set()) => {
  if (error === target) return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return contains(error.cause, target, seen) || (Array.isArray(error.errors) && error.errors.some(item => contains(item, target, seen)));
};
const read = async () => JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
let firstOwner;
const first = await withBakeoffCheckpoint(options, async owner => {
  firstOwner = owner; assert.equal(owner.existing.state, 'absent');
  const pending = await owner.write(payload()); assert.equal(pending.benchmarkCheckpoint.revision, 1);
  return owner.write(payload('completed'), { final: true });
});
assert.equal(first.benchmarkCheckpoint.revision, 2);
assert.equal(firstOwner.isSealed(), true);
assert.deepEqual(await read(), first);
assert.deepEqual(JSON.parse(await fs.readFile(firstOwner.finalPath, 'utf8')), first);
const original = await fs.readFile(checkpointPath, 'utf8');
await assert.rejects(firstOwner.write(payload()), error => error.code === 'ERR_BAKEOFF_CHECKPOINT_OWNER_CLOSED');
await assert.rejects(withBakeoffCheckpoint({ ...options, checkpointPath: firstOwner.finalPath }, () => {
  throw new Error('Immutable input must be rejected before this callback.');
}), error => error.code === 'ERR_BAKEOFF_IMMUTABLE_CHECKPOINT_TARGET');
assert.equal(await fs.readFile(firstOwner.finalPath, 'utf8'), original);

let enteredCorrupt = false;
await fs.writeFile(checkpointPath, '{"models":');
await assert.rejects(withBakeoffCheckpoint(options, async () => { enteredCorrupt = true; }), error => error.code === 'ERR_BAKEOFF_CHECKPOINT_CORRUPT');
assert.equal(enteredCorrupt, false); assert.equal(await fs.readFile(checkpointPath, 'utf8'), '{"models":');
await fs.writeFile(checkpointPath, original);
const resumed = await withBakeoffCheckpoint(options, async owner => {
  assert.equal(owner.existing.state, 'compatible');
  assert.equal(owner.existing.payload.models[0].modelId, 'fixture-model');
  assert.equal(await fs.readFile(owner.existing.sourceReceiptPath, 'utf8'), original, 'exact incoming bytes survive later publication');
  return owner.write(payload('completed'), { final: true });
});
assert.notEqual(resumed.benchmarkCheckpoint.runId, first.benchmarkCheckpoint.runId);
assert.equal(resumed.benchmarkCheckpoint.previousRunId, first.benchmarkCheckpoint.runId);
assert.equal(await fs.readFile(firstOwner.finalPath, 'utf8'), original, 'a later invocation does not overwrite earlier immutable evidence');

let release, entered;
const ready = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
let staleOwner, competitorEntered = false;
const writerA = withBakeoffCheckpoint(options, async owner => {
  staleOwner = owner; entered(); await barrier;
  return owner.write(payload('completed'), { final: true });
});
await ready;
await assert.rejects(withBakeoffCheckpoint(options, async () => { competitorEntered = true; }), error => error.code === 'ERR_BAKEOFF_CHECKPOINT_BUSY');
assert.equal(competitorEntered, false);
release(); await writerA;
const writerB = await withBakeoffCheckpoint(options, owner => owner.write(payload('completed'), { final: true }));
await assert.rejects(staleOwner.write(payload()), error => error.code === 'ERR_BAKEOFF_CHECKPOINT_OWNER_CLOSED');
assert.equal((await read()).benchmarkCheckpoint.runId, writerB.benchmarkCheckpoint.runId, 'late A cannot replace newer B');

const beforeFailure = await fs.readFile(checkpointPath, 'utf8');
const injected = new Error('fixture failure after fsync before publish');
let sawStaging = false;
await assert.rejects(withBakeoffCheckpoint({ ...options, writeOptions: { beforeCommit: async (_handle, staging) => {
  assert.equal(path.dirname(staging), path.dirname(checkpointPath));
  assert.ok((await fs.stat(staging)).size > 0); sawStaging = true; throw injected;
} } }, owner => owner.write(payload())), error => contains(error, injected));
assert.equal(sawStaging, true); assert.equal(await fs.readFile(checkpointPath, 'utf8'), beforeFailure);
await assert.rejects(fs.stat(checkpointPath + '.writer.lock'), error => error.code === 'ENOENT', 'settled failed write releases its original writer lock');

const changedSettings = { ...settings, mode: 'prose' };
await withBakeoffCheckpoint({ ...options, settings: changedSettings }, async owner => {
  assert.equal(owner.existing.state, 'incompatible-settings');
  await owner.write({ ...payload('failed'), settings: changedSettings }, { final: true, publishLatest: false });
});
assert.equal(await fs.readFile(checkpointPath, 'utf8'), beforeFailure, 'a startup-only failure can retain a separate final receipt without destroying resume state');

const mutable = structuredClone(settings);
await assert.rejects(withBakeoffCheckpoint({ ...options, settings: mutable }, async owner => {
  mutable.mode = 'changed-after-admission';
  await owner.write({ ...payload(), settings: mutable });
}), error => error.code === 'ERR_BAKEOFF_CHECKPOINT_IDENTITY');
assert.equal(await fs.readFile(checkpointPath, 'utf8'), beforeFailure);

let publishEntered, publishRelease;
const publicationReady = new Promise(resolve => { publishEntered = resolve; });
const publicationGate = new Promise(resolve => { publishRelease = resolve; });
let gated = false;
await withBakeoffCheckpoint({ ...options, writeOptions: { beforeCommit: async () => {
  if (!gated) { gated = true; publishEntered(); await publicationGate; }
} } }, async owner => {
  const writing = owner.write(payload());
  await publicationReady;
  await assert.rejects(owner.write(payload()), error => error.code === 'ERR_BAKEOFF_CHECKPOINT_CONCURRENT_WRITE');
  publishRelease(); await writing;
  const final = await owner.write(payload('completed'), { final: true });
  assert.equal(final.benchmarkCheckpoint.revision, 2);
});
console.log('Bakeoff checkpoint ownership preserves old bytes, atomic publication, immutable receipts and exact writer fencing.');
