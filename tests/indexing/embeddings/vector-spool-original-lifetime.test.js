import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createEmbeddingVectorSpool } from '../../../tools/build/embeddings/vector-spool.js';
import { createDeferredVectorSpoolRetirement } from '../../../tools/build/embeddings/publication.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: real original FileHandles, bounded IPC-free gates and exact nonce
// retirement. No model, crash-status retry, links or elevated operation.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['healthy', 'close-pending', 'close-recovery', 'unlink-recovery', 'unknown-child', 'replaced-file',
  'replaced-directory', 'frozen-write', 'falsey-write', 'pending-write', 'construction', 'observer-retention',
  'deferred-original', 'deferred-inspection', 'unobserved-directory'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'spool-owner-'));
const originalOpen = fs.open, originalUnlink = fs.unlink, originalLstat = fs.lstat;
let ready = false, inspectThrows = true, inspectionReady = false, observationPrimed = false, spool, constructionFailure;
let releaseGate, entered;
const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { releaseGate = resolve; });
const within = (promise, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not reach its fixture barrier.`)), 5000); })])
    .finally(() => clearTimeout(timer));
};
const closes = new Map(), closedSignals = new Map(), handles = new Map();
for (const name of ['code.uint8', 'doc.uint8', 'merged.uint8']) {
  let signal; const done = new Promise(resolve => { signal = resolve; }); closedSignals.set(name, { done, signal });
}
const inspection = Object.freeze(Object.assign(new Error('Independent original observer.'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => inspectionReady
}));
const owned = Object.freeze(Object.assign(new Error('Original spool operation.'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() {
    assert.equal(this, owned);
    if (['observer-retention', 'deferred-inspection'].includes(selected) && inspectThrows) { observationPrimed = true; throw inspection; }
    return ready;
  }
}));
const ordinary = Object.freeze(new Error('Frozen original write failure.'));
fs.open = async (file, ...args) => {
  const handle = await originalOpen(file, ...args);
  if (!String(file).includes('.stage3-vector-spool-')) return handle;
  const name = path.basename(file), close = handle.close, write = handle.write, truncate = handle.truncate;
  handles.set(name, handle);
  handle.close = async function () {
    const count = (closes.get(name) || 0) + 1; closes.set(name, count);
    if (name === 'code.uint8' && selected === 'close-pending') { entered(); await gate; }
    if (name === 'code.uint8' && ['close-recovery', 'observer-retention'].includes(selected) && count === 1) throw owned;
    const value = await close.call(this); closedSignals.get(name).signal(); return value;
  };
  handle.write = async function (...values) {
    if (name === 'code.uint8' && selected === 'frozen-write') throw ordinary;
    if (name === 'code.uint8' && selected === 'falsey-write') throw undefined;
    if (name === 'code.uint8' && selected === 'pending-write') { entered(); await gate; }
    return write.apply(this, values);
  };
  handle.truncate = async function (...values) {
    if (selected === 'construction') throw owned;
    return truncate.apply(this, values);
  };
  return handle;
};
fs.unlink = async (file, ...args) => {
  if (selected === 'unlink-recovery' && !ready && path.basename(file) === 'code.uint8') throw owned;
  return originalUnlink(file, ...args);
};
fs.lstat = async (file, ...args) => {
  if (selected === 'unobserved-directory' && path.basename(file).startsWith('.stage3-vector-spool-')) throw owned;
  return originalLstat(file, ...args);
};
const allCloses = () => Object.fromEntries(['code.uint8', 'doc.uint8', 'merged.uint8'].map(name => [name, closes.get(name) || 0]));
const expectedCloses = code => ({ 'code.uint8': code, 'doc.uint8': 1, 'merged.uint8': 1 });
const recover = async () => { ready = true; inspectThrows = false; inspectionReady = true; await spool.recoverAfterClose(); };
try {
  if (['construction', 'unobserved-directory'].includes(selected)) {
    await assert.rejects(createEmbeddingVectorSpool({ parentDir: root, count: 1, dims: 4 }), error => {
      constructionFailure = error; return errorGraphIncludes(error, owned);
    });
    const owner = constructionFailure.vectorSpoolLifetime; assert.ok(owner); assert.equal(owner.isSettled(), false);
    await fs.access(owner.directory);
    ready = true;
    if (selected === 'construction') {
      await owner.recoverAfterClose(); assert.equal(owner.isSettled(), true);
      assert.equal(closes.get('code.uint8'), 1); await assert.rejects(fs.stat(owner.directory), { code: 'ENOENT' });
    } else {
      fs.lstat = originalLstat;
      await assert.rejects(owner.recoverAfterClose(), /identity/); await fs.access(owner.directory);
      assert.equal(closes.size, 0, 'unobserved allocation opens no channel and grants no guessed deletion');
    }
  } else {
    spool = await createEmbeddingVectorSpool({ parentDir: root, count: 1, dims: 4 });
    const items = [{ index: 0 }], channels = Object.fromEntries(['code', 'doc', 'merged'].map(name => [name, [Uint8Array.of(1, 2, 3, 4)]]));
    if (['frozen-write', 'falsey-write'].includes(selected)) {
      let primary;
      await assert.rejects(spool.writeFile(items, channels), error => {
        primary = error; return error.vectorSpoolFailure === true && errorGraphIncludes(error, selected === 'falsey-write' ? undefined : ordinary);
      });
      await assert.rejects(spool.seal(), error => error === primary);
      await spool.close(); assert.equal(spool.isSettled(), true);
    } else if (selected === 'pending-write') {
      const writing = spool.writeFile(items, channels); await within(started, 'Accepted write');
      const closing = spool.close();
      assert.equal(spool.stats().closed, false); assert.equal(spool.stats().retiring, true); assert.equal(closes.size, 0);
      await assert.rejects(spool.writeFile(items, channels), { code: 'ERR_EMBEDDING_VECTOR_SPOOL' });
      releaseGate(); await assert.rejects(writing, { code: 'ERR_EMBEDDING_VECTOR_SPOOL' }); await closing;
      assert.equal(spool.isSettled(), true); assert.deepEqual(allCloses(), expectedCloses(1));
    } else if (selected.startsWith('deferred-')) {
      const retirement = createDeferredVectorSpoolRetirement(owned, spool);
      await assert.rejects(retirement.closeAfterWork()); assert.equal(closes.size, 0);
      assert.equal(retirement.isSettled(), false); ready = true; inspectThrows = false;
      if (selected === 'deferred-inspection') {
        assert.equal(observationPrimed, true); await assert.rejects(retirement.closeAfterWork());
      }
      inspectionReady = true;
      assert.deepEqual(await retirement.closeAfterWork(), { settled: true, pending: false });
      await retirement.closeAfterWork(); assert.deepEqual(allCloses(), expectedCloses(1)); assert.equal(retirement.isSettled(), true);
    } else if (selected === 'close-pending') {
      const closing = spool.close(); await within(started, 'Original close');
      await within(Promise.all(['doc.uint8', 'merged.uint8'].map(name => closedSignals.get(name).done)), 'Independent original closes');
      assert.equal(spool.stats().closed, false); assert.equal(spool.stats().retiring, true); await fs.access(spool.directory);
      releaseGate(); await closing; assert.equal(spool.stats().closed, true);
    } else if (['close-recovery', 'observer-retention'].includes(selected)) {
      let failure;
      await assert.rejects(spool.close(), error => { failure = error; return errorGraphIncludes(error, owned); });
      assert.equal(failure.cacheOwnershipReleased(), false); assert.deepEqual(allCloses(), expectedCloses(1));
      await fs.access(spool.directory); await assert.rejects(spool.recoverAfterClose());
      ready = true; inspectThrows = false;
      if (selected === 'observer-retention') {
        assert.equal(observationPrimed, true); await assert.rejects(spool.recoverAfterClose());
      }
      inspectionReady = true; await spool.recoverAfterClose();
      assert.equal(failure.cacheOwnershipReleased(), true); assert.deepEqual(allCloses(), expectedCloses(2));
    } else if (['unlink-recovery', 'unknown-child', 'replaced-file', 'replaced-directory'].includes(selected)) {
      const unknown = path.join(spool.directory, 'saved.txt'), code = path.join(spool.directory, 'code.uint8');
      const savedFile = path.join(root, 'original-code.uint8'), savedDirectory = path.join(root, 'original-directory');
      if (selected === 'unknown-child') await fs.writeFile(unknown, 'saved sentinel');
      if (selected === 'replaced-file') { await fs.rename(code, savedFile); await fs.writeFile(code, 'unrelated replacement'); }
      if (selected === 'replaced-directory') { await fs.rename(spool.directory, savedDirectory); await fs.mkdir(spool.directory); }
      await assert.rejects(spool.close()); assert.equal(spool.isSettled(), false); assert.deepEqual(allCloses(), expectedCloses(1));
      if (selected === 'unknown-child') { assert.equal(await fs.readFile(unknown, 'utf8'), 'saved sentinel'); await fs.unlink(unknown); }
      if (selected === 'replaced-file') { assert.equal(await fs.readFile(code, 'utf8'), 'unrelated replacement'); await fs.unlink(code); await fs.rename(savedFile, code); }
      if (selected === 'replaced-directory') { await fs.rmdir(spool.directory); await fs.rename(savedDirectory, spool.directory); }
      if (selected === 'unlink-recovery') { await assert.rejects(spool.recoverAfterClose()); assert.deepEqual(allCloses(), expectedCloses(1)); }
      await recover(); assert.equal(spool.isSettled(), true); assert.deepEqual(allCloses(), expectedCloses(1));
    } else {
      await spool.writeFile(items, channels); await spool.seal();
      assert.deepEqual(Array.from(spool.vectors.code[0]), [1, 2, 3, 4]); assert.equal(spool.stats().closed, false);
      for (const handle of handles.values()) handle.close = () => assert.fail('replacement close is not the original descriptor owner');
      await spool.close(); await spool.close(); assert.deepEqual(allCloses(), expectedCloses(1));
    }
    await assert.rejects(fs.stat(spool.directory), { code: 'ENOENT' });
  }
} finally {
  ready = true; inspectThrows = false; inspectionReady = true; releaseGate();
  fs.lstat = originalLstat; fs.unlink = originalUnlink;
  if (spool && !spool.isSettled()) await spool.recoverAfterClose();
  if (constructionFailure?.vectorSpoolLifetime && selected !== 'unobserved-directory') await constructionFailure.vectorSpoolLifetime.recoverAfterClose();
  fs.open = originalOpen;
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Vector spool original lifetime: ${selected}`);
