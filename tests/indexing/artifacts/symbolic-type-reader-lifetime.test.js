import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createTypeIrArena, serializeTypeIrRoots } from '../../../src/index/tooling/typescript/type-ir/index.js';
import { createSymbolicTypeGraph } from '../../../src/shared/symbolic-types.js';
import { enqueueSymbolicTypeArtifacts } from '../../../src/index/build/artifacts/writers/symbolic-types.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { openPublishedSymbolicTypeStore } from '../../../src/semantic/symbolic-type-store.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: registered publication -> actual bounded reader -> original FD faults.
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (caught) { failed = true; failure = caught; }
  assert.equal(failed, true); return failure;
};
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === expected) return true;
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-symbolic-reader-lifetime-'));
const originalOpen = fs.open, disposal = new Map();
try {
  applyTestEnv({ cacheRoot: path.join(root, 'cache') });
  const repoRoot = path.join(root, 'repo'), indexDir = path.join(root, 'index');
  await fs.mkdir(repoRoot); await fs.mkdir(indexDir);
  const generation = { baseBuildId: 'symbolic-reader-build', semanticRevision: 0 };
  const arena = createTypeIrArena({ contextKey: 'typescript:fixture:immutable-input' });
  const word = arena.union([arena.literal('first'), arena.literal('second')]);
  const graph = createSymbolicTypeGraph(serializeTypeIrRoots(arena, [word]));
  const ref = { schemaVersion: 1, domain: 'finite-string', graphId: graph.graphId, contextKey: arena.contextKey, nodeId: word.id };
  const registry = createArtifactPieceRegistry({ outDir: indexDir }), writes = [];
  enqueueSymbolicTypeArtifacts({ state: { chunks: [], symbolicTypeGraphs: [graph] }, outDir: indexDir,
    indexState: { buildId: generation.baseBuildId }, addPieceFile: registry.addPieceFile,
    declareArtifactFamily() {}, enqueueWrite: (_name, task) => writes.push(task) });
  for (const write of writes) await write();
  const pieces = await Promise.all(registry.listPieceEntries().map(async piece => ({ ...piece,
    checksum: 'sha256:' + createHash('sha256').update(await fs.readFile(path.join(indexDir, piece.path))).digest('hex') })));
  await writePiecesManifest({ pieceEntries: pieces, outDir: indexDir, mode: 'code',
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: generation.baseBuildId } });
  const manifestFile = path.join(indexDir, 'symbolic_type_manifest.json');
  const graphFile = path.join(indexDir, pieces.find(piece => piece.name === 'symbolic_type_graph').path);
  const query = { ref, operation: 'membership', value: 'first' };
  const open = () => openPublishedSymbolicTypeStore({ indexDir, repoRoot, generation });
  const install = ({ read = null, stat = null, close = null } = {}) => {
    const states = [];
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args), nativeRead = handle.read, nativeStat = handle.stat, nativeClose = handle.close;
      const state = { filename: path.resolve(String(file)), handle, reads: 0, stats: 0, closes: 0, maxRead: 0 }; states.push(state);
      disposal.set(handle, () => nativeClose.call(handle));
      handle.read = function (...readArgs) {
        assert.equal(this, handle); state.reads += 1; state.maxRead = Math.max(state.maxRead, readArgs[2]);
        const native = (...next) => nativeRead.call(handle, ...next); return read ? read(state, native, ...readArgs) : native(...readArgs);
      };
      handle.stat = function (...statArgs) {
        assert.equal(this, handle); state.stats += 1;
        const native = (...next) => nativeStat.call(handle, ...next); return stat ? stat(state, native, ...statArgs) : native(...statArgs);
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
  const recover = async (failure, state, allow) => {
    const session = getContainedFileSession(failure); assert.ok(session);
    const reads = state.reads, closes = state.closes;
    assert.equal(failure.cacheOwnershipReleased(), false); allow();
    const receipt = await session.releaseAfterClose();
    assert.equal(receipt.settled, true); assert.equal(receipt.pending, false);
    assert.equal(state.closes, closes + 1); assert.equal(state.reads, reads);
    assert.equal(state.handle.fd, -1); assert.equal(failure.cacheOwnershipReleased(), true);
  };

  {
    let replacements = 0;
    const states = install({ read: (state, native, ...args) => {
      state.handle.read = state.handle.stat = state.handle.close = () => { replacements += 1; throw new Error('replacement forbidden'); };
      return native(...args);
    } });
    const store = await open(); assert.equal((await store.query(query)).contains, true);
    assert.equal((await store.query({ ...query, value: 'absent' })).contains, false);
    assert.equal(replacements, 0); assert.equal(states.length, 2);
    assert.ok(states.every(state => state.closes === 1 && state.handle.fd === -1 && state.maxRead <= 65536));
    fs.open = originalOpen;
  }

  for (const filename of [manifestFile, graphFile]) {
    let deny = true;
    const closeFailure = Object.freeze(Object.assign(new Error('original symbolic close rejected'), { code: 'ENOENT' }));
    const states = install({ close: (state, native) => { if (state.filename === filename && deny) throw closeFailure; return native(); } });
    let store;
    const failure = await rejected(async () => { store = await open(); return store.query(query); });
    assert.equal(contains(failure, closeFailure), true);
    assert.notEqual(failure.reason, 'symbolic_type_missing', 'pending original close cannot be mapped to ordinary missing data');
    const state = states.find(entry => entry.filename === filename); assert.equal(state.closes, 1);
    state.handle.close = async () => { throw new Error('replacement cannot own recovery'); };
    await recover(failure, state, () => { deny = false; });
    assert.ok(states.every(entry => entry.handle.fd === -1)); fs.open = originalOpen;
    const freshStates = install();
    const fresh = store || await open(); assert.equal((await fresh.query(query)).contains, true);
    assert.equal(freshStates.filter(entry => entry.filename === graphFile).length, 1,
      'close-only recovery cannot publish the withheld graph into the query cache');
    fs.open = originalOpen;
  }

  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen graph read failure'))]) {
    const store = await open(); let deny = true;
    const secondary = Object.freeze(new Error('independent graph close failure'));
    const states = install({ read: (state, native, ...args) => { if (state.filename === graphFile) throw primary; return native(...args); },
      close: (state, native) => { if (state.filename === graphFile && deny) throw secondary; return native(); } });
    const failure = await rejected(() => store.query(query));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(states.length, 1); assert.equal(states[0].closes, 1);
    await recover(failure, states[0], () => { deny = false; }); fs.open = originalOpen;
    assert.equal((await store.query(query)).contains, true);
  }

  for (const marker of [undefined, false, true]) {
    const store = await open(); let settled = false;
    const primary = Object.defineProperties(new Error('original graph read owns native work'), {
      ...(marker === undefined ? {} : { cacheOwnershipPending: { value: marker } }),
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true }
    });
    const states = install({ read: state => { assert.equal(state.filename, graphFile); throw primary; } });
    const failure = await rejected(() => store.query(query)); primary.cacheOwnershipReleased = () => true;
    assert.equal(states.length, 1); assert.equal(states[0].closes, 0);
    await rejected(() => getContainedFileSession(failure).releaseAfterClose());
    assert.equal(states[0].closes, 0, 'promise rejection and observer replacement cannot authorize native destruction');
    await recover(failure, states[0], () => { settled = true; }); fs.open = originalOpen;
  }

  {
    let deny = true;
    const secondary = Object.freeze(new Error('limit-path original close rejected'));
    const states = install({ stat: async (state, native, ...args) => {
      const actual = await native(...args); assert.equal(state.filename, manifestFile);
      return { ...actual, size: 2 * 1024 * 1024 + 1 };
    }, close: (_state, native) => { if (deny) throw secondary; return native(); } });
    const failure = await rejected(open);
    assert.equal(failure.reason, 'symbolic_type_limit'); assert.equal(contains(failure, secondary), true);
    assert.equal(states[0].reads, 0);
    await recover(failure, states[0], () => { deny = false; }); fs.open = originalOpen;
  }

  for (const inspectionKind of ['code', undefined, null, false, 0, '', 'pending-inspection']) {
    const store = await open(); let settled = true, inspectionSettled = false;
    const inspection = inspectionKind === 'pending-inspection'
      ? Object.freeze(Object.assign(new Error('symbolic diagnostic getter owns pending work'), {
        cacheOwnershipReleased() { return inspectionSettled; }
      })) : inspectionKind;
    const primary = Object.defineProperties(new Error('symbolic original read rejected'), {
      cacheOwnershipReleased: { value() { assert.equal(this, primary); return settled; }, writable: true },
      code: { get() {
        assert.equal(this, primary); primary.cacheOwnershipReleased = () => true; settled = false;
        if (inspectionKind !== 'code') throw inspection; return 'ENOENT';
      } }
    });
    const states = install({ read: () => { throw primary; } });
    const failure = await rejected(() => store.query(query));
    assert.equal(contains(failure, primary), true);
    if (inspectionKind !== 'code') assert.equal(contains(failure, inspection), true);
    assert.notEqual(failure.reason, 'symbolic_type_missing');
    assert.equal(failure.cacheOwnershipReleased(), false, 'classification keeps the originally captured observer');
    assert.equal(states[0].closes, 1, 'the descriptor closed while its original work still reported settled');
    settled = true; inspectionSettled = true; assert.equal(failure.cacheOwnershipReleased(), true); fs.open = originalOpen;
  }

  const missingStore = await open(), originalGraph = await fs.readFile(graphFile);
  await fs.unlink(graphFile);
  await assert.rejects(missingStore.query(query), error => error.reason === 'symbolic_type_missing');
  await fs.writeFile(graphFile, originalGraph);
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) { try { await dispose(); } catch {} }
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Symbolic type readers retain exact descriptor failures and withhold unclosed graph results.');
