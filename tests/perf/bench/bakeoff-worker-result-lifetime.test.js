import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { withBakeoffCheckpoint } from '../../../tools/bench/embeddings/bakeoff-checkpoint.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual checkpoint writer, accepted-write drain and published
// lock session. No model, corpus, compiler or benchmark process is executed.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['pending', 'unmarked', 'settled', 'replacement', 'after-write', 'secondary-write', 'falsey', 'independent-observer'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'bakeoff-worker-lifetime-'));
const checkpointPath = path.join(root, 'checkpoint.json'), lockPath = checkpointPath + '.writer.lock';
const settings = { models: ['fixture'], mode: 'code' };
let settled = ['settled', 'after-write', 'secondary-write'].includes(selected), inspectionSettled = false, calls = 0, release;
const secondary = Object.freeze(Object.assign(new Error('independent original publication/observer failure'), {
  ...(selected === 'independent-observer' ? { cacheOwnershipReleased: () => inspectionSettled } : {})
}));
const result = { data: 'original worker result', ...(selected === 'pending' ? { cacheOwnershipPending: true } : {}),
  cacheOwnershipReleased() { assert.equal(this, result); if (selected === 'independent-observer' && !settled) throw secondary; return settled; } };
let entered; const ready = new Promise(resolve => { entered = resolve; });
const writeOptions = ['after-write', 'secondary-write'].includes(selected) ? { beforeCommit: async () => {
  entered(); await new Promise(resolve => { release = resolve; });
  settled = false; result.cacheOwnershipReleased = () => true;
  if (selected === 'secondary-write') throw secondary;
} } : {};
const options = { root, checkpointPath, receiptRoot: path.join(root, 'receipts'), settings, writeOptions };
let failure, failed = false, evidence;
try {
  const run = withBakeoffCheckpoint(options, async owner => {
    calls++;
    if (selected === 'falsey') throw null;
    if (writeOptions.beforeCommit) {
      const writing = owner.write({ settings, progress: { status: 'running' }, models: [] });
      writing.catch(() => {}); await ready;
    }
    return result;
  });
  if (writeOptions.beforeCommit) { await ready; await setImmediate(); release(); }
  try { assert.equal(await run, result); } catch (error) { failed = true; failure = error; }
  assert.equal(calls, 1);
  if (selected === 'settled') {
    assert.equal(failed, false); await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  } else if (selected === 'falsey') {
    assert.equal(failed, true); assert.equal(failure, null); await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  } else {
    assert.equal(failed, true); assert.equal(failure.cacheOwnershipReleased(), false); await fs.stat(lockPath);
    assert.equal(errorGraphIncludes(failure.workerError || failure, result), true, 'original result remains reachable through the existing worker-error contract');
    if (selected === 'secondary-write' || selected === 'independent-observer') assert.equal(errorGraphIncludes(failure.workerError || failure, secondary), true);
    let admitted = false;
    await assert.rejects(withBakeoffCheckpoint(options, () => { admitted = true; }), { code: 'ERR_BAKEOFF_CHECKPOINT_BUSY' });
    assert.equal(admitted, false);
    if (selected === 'replacement') result.cacheOwnershipReleased = () => true;
    const original = failure.fileLockPublicationSession; assert.ok(original);
    errorGraphSome(failure.workerError || failure, value => { evidence ||= value?.benchmarkEvidenceOwner; return false; });
    assert.ok(evidence, 'the original benchmark evidence owner remains available for explicit settlement');
    await assert.rejects(original.releaseAfterClose());
    settled = true;
    if (selected === 'independent-observer') { await assert.rejects(evidence.closeAfterSettlement()); inspectionSettled = true; }
    await evidence.closeAfterSettlement();
    await original.releaseAfterClose(); assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(calls, 1);
    assert.equal(await withBakeoffCheckpoint({ ...options, writeOptions: {} }, () => 7), 7, 'settled metadata recovery permits a fresh invocation');
    await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
  }
} finally {
  settled = true; inspectionSettled = true; release?.();
  await evidence?.closeAfterSettlement();
  if (failure?.fileLockPublicationSession) await failure.fileLockPublicationSession.releaseAfterClose();
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Bakeoff worker result lifetime: ${selected}`);
