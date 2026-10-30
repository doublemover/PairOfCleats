import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

// UNVALIDATED. Real query-index data/offset descriptors and failed original
// operations; no retry, publication, runtime or native qualification is implied.
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (caught) { failed = true; failure = caught; }
  assert.equal(failed, true); return failure;
};
const visit = (failure, inspect) => {
  const pending = [failure], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); inspect(value);
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
};
const contains = (failure, expected) => {
  let found = false; visit(failure, value => { if (value === expected) found = true; }); return found;
};
const f = await createRecoveryFixture('query index');
const originalOpen = fs.open, originalRemove = fs.rm, disposal = new Map();
try {
  const ref = localId => ({ partitionId: f.partitionId, localId });
  const partition = await f.write([semanticNode(0, f.source.textLength), semanticNode(1, f.source.textLength),
    { family: 'operand', row: { parent: ref(0), child: ref(1), slot: 'callee', ordinal: 0, flags: [] } }]);
  const base = f.store([partition]);
  const options = { generation: f.generation, partitions: [partition], store: base };
  const retire = async (directory, account) => {
    await originalRemove.call(fs, directory, { recursive: true, force: true });
    account.release(account.used);
  };
  let sequence = 0;
  for (const mode of ['offset-close', 'offset-write', 'offset-sync', 'data-close', 'data-sync']) {
    const root = path.join(f.root, 'fault-' + sequence++), account = createSemanticDiskAccount(1024 * 1024);
    const closeFailure = Object.freeze(new Error('original query-index close rejected'));
    const writeFailure = mode === 'offset-write' ? 0 : mode === 'offset-sync' ? undefined : false;
    let deny = true, removals = 0;
    const states = [];
    fs.open = async (file, flags, ...args) => {
      const handle = await originalOpen.call(fs, file, flags, ...args);
      const selected = mode.startsWith('offset-') ? String(file).endsWith('.offsets') && flags === 'wx'
        : String(file).endsWith('.jsonl') && flags === 'r+';
      if (!selected) return handle;
      const close = handle.close, writeFile = handle.writeFile, sync = handle.sync;
      const state = { handle, writes: 0, syncs: 0, closes: 0, replacementCloses: 0, replacementSyncs: 0 };
      states.push(state); disposal.set(handle, () => close.call(handle));
      handle.close = function () {
        assert.equal(this, handle); state.closes++;
        if (deny) throw closeFailure;
        return close.call(handle).then(value => { disposal.delete(handle); return value; });
      };
      const replaceClose = () => { handle.close = async () => { state.replacementCloses++; }; };
      handle.writeFile = async function (...writeArgs) {
        assert.equal(this, handle); state.writes++;
        replaceClose();
        // A later property lookup must not replace the already captured fsync.
        handle.sync = async () => { state.replacementSyncs++; };
        if (mode === 'offset-write') throw writeFailure;
        return writeFile.apply(handle, writeArgs);
      };
      handle.sync = function () {
        assert.equal(this, handle); state.syncs++; replaceClose();
        if (mode.endsWith('-sync')) throw writeFailure;
        return sync.call(handle);
      };
      return handle;
    };
    fs.rm = async (file, removeOptions) => {
      if (path.basename(String(file)).startsWith('semantic-query-index-')) removals++;
      return originalRemove.call(fs, file, removeOptions);
    };
    const failure = await rejected(() => writeSemanticQueryIndex({ ...options, root, diskAccount: account }));
    assert.equal(states.length, 1);
    const state = states[0];
    assert.equal(contains(failure, closeFailure), true);
    if (mode === 'offset-write' || mode.endsWith('-sync')) assert.equal(contains(failure, writeFailure), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(state.closes, 1);
    assert.equal(state.replacementCloses, 0); assert.equal(state.replacementSyncs, 0);
    assert.equal(removals, 0, 'pending original ownership prohibits even attempting retirement');
    assert.ok(account.used > 0);
    assert.equal(failure.semanticQueryIndexReservedBytes, account.used);
    const directory = failure.semanticQueryIndexDirectory;
    assert.ok((await fs.readdir(directory)).some(file => file.endsWith('.jsonl')));
    const sessions = new Set();
    visit(failure, value => { const session = getContainedFileSession(value); if (session) sessions.add(session); });
    assert.equal(sessions.size, 1);
    const writes = state.writes, syncs = state.syncs, used = account.used;
    deny = false;
    for (const session of sessions) assert.deepEqual(await session.releaseAfterClose(), {
      resourceId: session.resourceId, settled: true, pending: false
    });
    assert.equal(state.handle.fd, -1); assert.equal(state.closes, 2);
    assert.equal(state.writes, writes); assert.equal(state.syncs, syncs);
    assert.equal(state.replacementCloses, 0);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(removals, 0); assert.equal(account.used, used,
      'close-only recovery does not replay deletion or release byte credits');
    fs.open = originalOpen; fs.rm = originalRemove;
    await retire(directory, account);
  }

  // Preserve falsey primary/cleanup failures and a frozen primary after real
  // final bytes exist; no writable cleanupError field is required on that cause.
  for (const [primary, secondary] of [
    [undefined, Object.freeze(new Error('cleanup refused'))],
    [0, Object.freeze(new Error('cleanup refused'))],
    [Object.freeze(new Error('primary is frozen')), null],
    [Object.freeze(new Error('primary is frozen')), false]
  ]) {
    const root = path.join(f.root, 'cleanup-' + sequence++), account = createSemanticDiskAccount(1024 * 1024);
    let directory;
    fs.rm = async (file, removeOptions) => {
      if (path.basename(String(file)).startsWith('semantic-query-index-')) { directory = String(file); throw secondary; }
      return originalRemove.call(fs, file, removeOptions);
    };
    const rows = [0, 1].map(rowOrdinal => ({ owner: ref(0), member: 'semantic_operands', partitionId: f.partitionId, rowOrdinal }));
    const orderedEntries = (async function* () { yield* rows; throw primary; })();
    const failure = await rejected(() => writeSemanticQueryIndex({ ...options, root, diskAccount: account,
      orderedEntries, batchRows: 1 }));
    assert.equal(contains(failure, primary), true);
    assert.equal(contains(failure, secondary), true);
    assert.equal(failure.cleanupError, secondary);
    assert.ok(account.used > 0); assert.ok(directory);
    assert.ok((await fs.readdir(directory)).some(file => file.endsWith('.jsonl')));
    fs.rm = originalRemove; await retire(directory, account);
  }

  const root = path.join(f.root, 'success'), account = createSemanticDiskAccount(1024 * 1024);
  const result = await writeSemanticQueryIndex({ ...options, root, diskAccount: account });
  assert.equal(result.rowCount, 1); assert.equal(result.pieces.length, 1);
  assert.equal(account.used, result.pieces[0].bytes + 8);
  console.log('Query-index failures retain original descriptors, all causes and physical byte credits');
} finally {
  fs.open = originalOpen; fs.rm = originalRemove;
  for (const dispose of disposal.values()) await dispose();
  await f.cleanup();
}
