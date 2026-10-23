import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { getContainedFileSession, isContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';

// UNVALIDATED: actual store, JSONL readers and original FileHandle close faults.
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (caught) { failed = true; failure = caught; }
  assert.equal(failed, true, 'failed cleanup must withhold the successful value');
  return failure;
};
const visitFailures = (failure, inspect) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); inspect(value);
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
};
const contains = (failure, expected) => {
  let found = false; visitFailures(failure, value => { if (value === expected) found = true; }); return found;
};
const sessionsOf = failure => {
  const sessions = new Set();
  visitFailures(failure, value => {
    const single = getContainedFileSession(value); if (single) sessions.add(single);
    if (value === null || !['object', 'function'].includes(typeof value)) return;
    const group = Object.getOwnPropertyDescriptor(value, 'containedFileSessions')?.value;
    if (Array.isArray(group)) for (const session of group) {
      assert.equal(isContainedFileSession(session), true); sessions.add(session);
    }
  });
  assert.ok(sessions.size > 0); return [...sessions];
};
const fixture = await createRecoveryFixture('fixture();\n'.repeat(32));
const originalOpen = fs.open, disposal = new Map();
try {
  const nodes = Array.from({ length: 600 }, (_, id) => semanticNode(id, fixture.source.textLength));
  const names = Array.from({ length: 600 }, (_, id) => ({ family: 'lookup', row: { kind: 'name', id, value: `entry-${id}` } }));
  const first = await fixture.write([...nodes, ...names]);
  const second = await fixture.write(nodes, { partitionId: 'sa1:' + 'c'.repeat(64) });
  const small = await fixture.write([semanticNode(0, fixture.source.textLength)], { partitionId: 'sa1:' + 'd'.repeat(64) });
  for (const partition of [first, second]) {
    assert.equal(partition.members.semantic_records.length, 1);
    assert.ok(partition.members.semantic_records[0].bytes > 65536, 'retain actual descriptors through row decoding');
  }
  const ref = partition => ({ partitionId: partition.partitionId, localId: 0 });
  const base = fixture.store([first]);
  const queryIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
    partitions: [first], store: base, diskAccount: fixture.account, batchRows: 1024, batchBytes: 1048576 });
  assert.equal(queryIndex.pieces.length, 1); assert.ok(queryIndex.pieces[0].bytes > 65536);
  const queryFile = path.resolve(fixture.stagingRoot, queryIndex.pieces[0].path);
  const queryOffsets = path.resolve(fixture.stagingRoot, queryIndex.pieces[0].offsetsPath);
  const install = ({ open = null, read: readFault = null, close = null } = {}) => {
    const states = [];
    fs.open = async (file, ...args) => {
      const filename = path.resolve(String(file));
      if (open) await open(filename);
      const handle = await originalOpen(file, ...args), read = handle.read, nativeClose = handle.close;
      const state = { filename, handle, reads: 0, closes: 0 }; states.push(state);
      disposal.set(handle, () => nativeClose.call(handle));
      handle.read = function (...readArgs) {
        assert.equal(this, handle); state.reads += 1;
        const native = (...next) => read.call(handle, ...next);
        return readFault ? readFault(state, native, ...readArgs) : native(...readArgs);
      };
      handle.close = function () {
        assert.equal(this, handle); state.closes += 1;
        const native = async () => { const value = await nativeClose.call(handle); disposal.delete(handle); return value; };
        return close ? close(state, native) : native();
      };
      return handle;
    };
    return states;
  };
  const recover = async (failure, states, allow) => {
    const sessions = sessionsOf(failure), reads = states.map(state => state.reads), closes = states.map(state => state.closes);
    assert.equal(failure.cacheOwnershipReleased(), false);
    allow();
    for (const session of sessions) {
      const receipt = await session.releaseAfterClose();
      assert.equal(receipt.settled, true); assert.equal(receipt.pending, false);
    }
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.deepEqual(states.map(state => state.reads), reads, 'recovery does not replay source verification or semantic reads');
    assert.ok(states.every((state, index) => state.closes === closes[index] + 1));
    assert.ok(states.every(state => state.handle.fd === -1));
    fs.open = originalOpen;
  };

  for (const partition of [small, first]) {
    const states = install(), store = fixture.store([partition]);
    assert.equal((await store.getRecords([ref(partition)]))[0].id, 0);
    await store.withReadScope(async () => {
      assert.equal((await store.getRecords([ref(partition)]))[0].id, 0);
      assert.equal(await store.withReadScope(() => Promise.resolve('nested')), 'nested');
    });
    assert.ok(states.every(state => state.closes === 1 && state.handle.fd === -1)); fs.open = originalOpen;
  }

  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen semantic operation failure'))]) {
    let deny = true;
    const dataFailure = Object.freeze(new Error('original data descriptor close rejected'));
    const offsetFailure = Object.freeze(new Error('original offsets descriptor close rejected'));
    const states = install({ close: (state, native) => {
      if (deny) throw state.filename.endsWith('.offsets') ? offsetFailure : dataFailure;
      return native();
    } });
    const store = fixture.store([first, second]);
    const failure = await rejected(() => store.withReadScope(async () => {
      assert.equal((await store.getRecords([ref(first), ref(second)])).length, 2); throw primary;
    }));
    assert.equal(contains(failure, primary), true);
    assert.equal(contains(failure, dataFailure), true); assert.equal(contains(failure, offsetFailure), true);
    assert.equal(states.length, 4); assert.ok(states.every(state => state.closes === 1));
    assert.equal(sessionsOf(failure).length, 4, 'all independent piece owners remain discoverable in original causes');
    await recover(failure, states, () => { deny = false; });
    assert.equal((await store.getRecords([ref(first)]))[0].id, 0, 'later reads acquire and verify fresh owners');
  }

  {
    let deny = true, observed = null;
    const closeFailure = Object.freeze(new Error('snapshot close failure cannot be swallowed by its callback'));
    const states = install({ close: (_state, native) => { if (deny) throw closeFailure; return native(); } });
    const store = fixture.store([small]);
    const failure = await rejected(() => store.withReadScope(async () => {
      observed = await rejected(() => store.getRecords([ref(small)])); return 'withheld';
    }));
    assert.equal(failure, observed, 'a rejected opening stays a failed scoped owner even if the callback catches it');
    assert.equal(contains(failure, closeFailure), true); assert.ok(states.every(state => state.closes === 1));
    await recover(failure, states, () => { deny = false; });
  }

  {
    let deny = true;
    const peerFailure = Object.freeze(new Error('successful peer reader close rejected'));
    const missing = path.resolve(fixture.stagingRoot, first.members.semantic_records[0].path);
    const states = install({ open: filename => { if (filename === missing) throw false; },
      close: (_state, native) => { if (deny) throw peerFailure; return native(); } });
    const store = fixture.store([first, second]);
    const failure = await rejected(() => store.withReadScope(async () => {
      await Promise.allSettled([store.getRecords([ref(first)]), store.getRecords([ref(second)])]); return 'withheld';
    }));
    assert.equal(contains(failure, false), true); assert.equal(contains(failure, peerFailure), true);
    assert.equal(states.length, 3); assert.ok(states.every(state => state.closes === 1));
    await recover(failure, states, () => { deny = false; });
  }

  {
    let deny = true;
    const closeFailure = Object.freeze(new Error('one-shot close failure'));
    const states = install({ close: (_state, native) => { if (deny) throw closeFailure; return native(); } });
    const store = fixture.store([first], { maxRecordBytes: 1 });
    const failure = await rejected(() => store.getRecords([ref(first)]));
    let tooLarge = false;
    visitFailures(failure, value => { if (value?.code === 'ERR_JSON_TOO_LARGE') tooLarge = true; });
    assert.equal(tooLarge, true, 'one-shot cleanup preserves its original row-size failure');
    assert.equal(contains(failure, closeFailure), true);
    await recover(failure, states, () => { deny = false; });
  }

  for (const finish of ['return', 'throw']) {
    let deny = false;
    const primary = Object.freeze(new Error('iterator consumer rejected'));
    const closeFailure = Object.freeze(new Error('iterator close rejected'));
    const states = install({ close: (_state, native) => { if (deny) throw closeFailure; return native(); } });
    const iterator = fixture.store([first]).iterateRows(first.partitionId, 'semantic_records');
    assert.equal((await iterator.next()).value.id, 0); deny = true;
    const failure = await rejected(() => finish === 'throw' ? iterator.throw(primary) : iterator.return());
    assert.equal(contains(failure, closeFailure), true);
    if (finish === 'throw') assert.equal(contains(failure, primary), true);
    await recover(failure, states, () => { deny = false; });
  }

  for (const inspectionKind of ['code', undefined, null, false, 0, '', 'pending-inspection']) {
    let originalSettled = true, inspectionSettled = false;
    const inspection = inspectionKind === 'pending-inspection'
      ? Object.freeze(Object.assign(new Error('code inspection owns independent pending work'), {
        cacheOwnershipPending: true, cacheOwnershipReleased() { return inspectionSettled; }
      })) : inspectionKind;
    const primary = Object.defineProperties(new Error('actual verification read rejected'), {
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return originalSettled; }, writable: true },
      code: { get() {
        assert.equal(this, primary);
        primary.cacheOwnershipReleased = () => true;
        originalSettled = false;
        if (inspectionKind !== 'code') throw inspection;
        return 'ERR_JSONL_CONTENT_INTEGRITY';
      } }
    });
    const dataFile = path.resolve(fixture.stagingRoot, first.members.semantic_records[0].path);
    const states = install({ read: (state, native, ...args) => {
      if (state.filename === dataFile) throw primary; return native(...args);
    } });
    const failure = await rejected(() => fixture.store([first]).getRecords([ref(first)]));
    assert.equal(contains(failure, primary), true);
    if (inspectionKind !== 'code') assert.equal(contains(failure, inspection), true);
    assert.equal(failure.cacheOwnershipReleased(), false, 'classification retains the observation captured before hostile code inspection');
    assert.ok(states.every(state => state.closes === 0), 'changed original work cannot authorize native destruction');
    await recover(failure, states, () => { originalSettled = true; inspectionSettled = true; });
  }

  {
    let deny = true;
    const closeFailure = Object.freeze(new Error('related-page query reader close rejected'));
    const states = install({ close: (state, native) => {
      if (deny && [queryFile, queryOffsets].includes(state.filename)) throw closeFailure; return native();
    } });
    const store = fixture.store([first], { queryIndex });
    const failure = await rejected(() => store.getRelatedPage(ref(first), 'semantic_lookup', { limit: 1 }));
    assert.equal(contains(failure, closeFailure), true);
    const queryStates = states.filter(state => [queryFile, queryOffsets].includes(state.filename));
    assert.equal(queryStates.length, 2); assert.ok(queryStates.every(state => state.closes === 1));
    await recover(failure, queryStates, () => { deny = false; });
    assert.ok(states.every(state => state.handle.fd === -1));
    assert.equal((await store.getRelatedPage(ref(first), 'semantic_lookup', { limit: 1 })).rows[0].value, 'entry-0');
  }
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  await fixture.cleanup();
}
console.log('Semantic store cleanup preserves failed reader ownership and independent operation errors.');
