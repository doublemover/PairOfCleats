import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { loadIndexState, writeIndexState } from '../../../tools/build/embeddings/state.js';
import { publishEmbeddingFailure } from '../../../tools/build/embeddings/publication.js';
import { publishIndexStateMutation, withIndexStatePublicationLock } from '../../../src/shared/index-state-publication.js';
import { updateSqliteState } from '../../../src/storage/sqlite/build/index-state.js';
import { updateLmdbState } from '../../../src/storage/lmdb/index-state.js';
import { checksumFile } from '../../../src/shared/hash.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: real embedding/native producers, original loaded baselines and
// publication locks. No native database, model, or physical link is required.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['merge-native', 'merge-extensions', 'conflicting-embeddings', 'conflicting-extension',
  'idempotent', 'deletion', 'identity-change', 'caller-identity-change', 'copied-state', 'wrong-path',
  'initial-claim-race', 'stale-ready', 'stale-terminal', 'terminal-generation-replaced',
  'capture-before-wait', 'retained-caller-change', 'repeated-native', 'extension-prototype',
  'invalid-extensions'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'embedding-state-conflict-'));
const statePath = path.join(root, 'index_state.json'), manifestPath = path.join(root, 'pieces', 'manifest.json');
const initial = { mode: 'code', buildId: 'original-generation', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  generatedAt: '2026-10-28T00:00:00.000Z', embeddings: { ready: false, pending: true, count: 1 },
  sqlite: { original: true }, lmdb: { original: true }, extensions: { caller: { original: true }, removable: 'old' } };
const read = async () => JSON.parse(await fs.readFile(statePath, 'utf8'));
const bytes = () => fs.readFile(statePath, 'utf8');
const rejectedUnchanged = async action => {
  const before = await bytes(), manifest = await fs.readFile(manifestPath, 'utf8');
  await assert.rejects(action, { code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT' });
  assert.equal(await bytes(), before); assert.equal(await fs.readFile(manifestPath, 'utf8'), manifest);
};
const claim = async (state, id) => {
  state.extensions.runtimeAttemptId = id;
  await writeIndexState(statePath, state, { attemptId: id, claimAttempt: true });
};
try {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(initial));
  await fs.writeFile(manifestPath, JSON.stringify({ version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'index_state', type: 'stats', format: 'json', path: 'index_state.json' },
      { name: 'unrelated', path: 'unrelated.json', bytes: 2, checksum: 'unchanged' }] }));
  const state = loadIndexState(statePath);
  if (['merge-native', 'repeated-native'].includes(selected)) {
    await updateSqliteState(root, { ready: true, count: 7 });
    await updateLmdbState(root, { ready: true, count: 9 });
    state.embeddings = { ready: true, pending: false, count: 3 };
    await writeIndexState(statePath, state);
    if (selected === 'repeated-native') {
      await updateSqliteState(root, { count: 11 });
      state.embeddings.count = 5; await writeIndexState(statePath, state);
    }
    const saved = await read();
    assert.equal(saved.sqlite.count, selected === 'repeated-native' ? 11 : 7);
    assert.equal(saved.lmdb.count, 9); assert.equal(saved.sqlite.original, true); assert.equal(saved.lmdb.original, true);
    assert.equal(saved.embeddings.count, selected === 'repeated-native' ? 5 : 3);
    assert.deepEqual(state.sqlite, initial.sqlite, 'publication cannot replace caller data with a newly merged object');
  } else if (['merge-extensions', 'deletion', 'extension-prototype'].includes(selected)) {
    await publishIndexStateMutation(root, current => { current.extensions.native = { newer: true }; });
    if (selected === 'deletion') delete state.extensions.removable;
    else if (selected === 'extension-prototype') Object.defineProperty(state.extensions, '__proto__', {
      enumerable: true, value: { ownedValue: true }
    });
    else state.extensions.caller = { original: true, changed: true };
    await writeIndexState(statePath, state);
    const saved = await read(); assert.deepEqual(saved.extensions.native, { newer: true });
    if (selected === 'deletion') assert.equal(Object.hasOwn(saved.extensions, 'removable'), false);
    else if (selected === 'extension-prototype') {
      assert.equal(Object.hasOwn(saved.extensions, '__proto__'), true);
      assert.deepEqual(saved.extensions.__proto__, { ownedValue: true }); assert.equal({}.ownedValue, undefined);
    } else assert.deepEqual(saved.extensions.caller, { original: true, changed: true });
  } else if (['conflicting-embeddings', 'conflicting-extension', 'idempotent'].includes(selected)) {
    const peer = loadIndexState(statePath);
    if (selected === 'conflicting-extension') { peer.extensions.caller = { peer: true }; state.extensions.caller = { local: true }; }
    else { peer.embeddings.count = 2; state.embeddings.count = selected === 'idempotent' ? 2 : 3; }
    await writeIndexState(statePath, peer);
    if (selected === 'idempotent') { await writeIndexState(statePath, state); assert.equal((await read()).embeddings.count, 2); }
    else await rejectedUnchanged(() => writeIndexState(statePath, state));
  } else if (['identity-change', 'caller-identity-change'].includes(selected)) {
    if (selected === 'identity-change') await publishIndexStateMutation(root, current => { current.buildId = 'replacement-generation'; });
    else state.buildId = 'caller-replacement';
    state.embeddings.ready = true;
    await rejectedUnchanged(() => writeIndexState(statePath, state));
  } else if (selected === 'copied-state') {
    const copy = structuredClone(state); copy.embeddings.ready = true;
    await rejectedUnchanged(() => writeIndexState(statePath, copy));
  } else if (selected === 'wrong-path') {
    const other = path.join(root, 'other'); await fs.mkdir(other);
    await rejectedUnchanged(() => writeIndexState(path.join(other, 'index_state.json'), state));
    await assert.rejects(fs.stat(path.join(other, 'index_state.json')), { code: 'ENOENT' });
  } else if (selected === 'initial-claim-race') {
    const peer = loadIndexState(statePath);
    await claim(state, 'attempt-a');
    await rejectedUnchanged(() => claim(peer, 'attempt-b'));
    assert.equal((await read()).extensions.runtimeAttemptId, 'attempt-a');
  } else if (['stale-ready', 'stale-terminal', 'terminal-generation-replaced'].includes(selected)) {
    await claim(state, 'attempt-a');
    if (selected === 'terminal-generation-replaced') await publishIndexStateMutation(root, current => {
      current.buildId = 'replacement-generation'; delete current.extensions.runtimeAttemptId;
    });
    else await claim(loadIndexState(statePath), 'attempt-b');
    if (selected === 'stale-ready') {
      state.embeddings = { ready: true, pending: false }; await rejectedUnchanged(() => writeIndexState(statePath, state));
    } else {
      const before = await bytes(), primary = Object.freeze(new Error('original attempt failed'));
      const failure = await publishEmbeddingFailure({ primary, statePath, mode: 'code',
        runtimeReceipts: { fail: async () => {}, reference: () => 'attempt-a', observation: () => ({ state: 'failed' }) },
        prepareState: () => {
          const terminal = loadIndexState(statePath, { publicationSource: state });
          terminal.embeddings = { ready: false, pending: false, lastError: primary.message }; return terminal;
        } });
      assert.equal(errorGraphIncludes(failure, primary), true);
      assert.equal(errorGraphSome(failure, item => item?.code === 'ERR_INDEX_STATE_PUBLICATION_CONFLICT'), true);
      assert.equal(await bytes(), before, 'terminal diagnostics cannot overwrite a replacement attempt/generation');
    }
  } else if (['capture-before-wait', 'retained-caller-change'].includes(selected)) {
    let release, entered;
    const acquired = new Promise(resolve => { entered = resolve; });
    const held = withIndexStatePublicationLock(root, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
    await acquired;
    state.embeddings.count = 2;
    const publication = writeIndexState(statePath, state);
    state.embeddings.count = 3;
    await setImmediate(); release(); await held; await publication;
    assert.equal((await read()).embeddings.count, 2, 'queued publication owns the captured request');
    assert.equal(state.embeddings.count, 3, 'publication cannot discard later caller mutation');
    if (selected === 'retained-caller-change') { await writeIndexState(statePath, state); assert.equal((await read()).embeddings.count, 3); }
  } else {
    state.extensions = null;
    await assert.rejects(writeIndexState(statePath, state), /extensions object/u);
    assert.deepEqual(await read(), initial);
  }
  // Every successful state change must refresh the actual existing state piece.
  if (!['copied-state', 'wrong-path', 'caller-identity-change', 'invalid-extensions'].includes(selected)) {
    const piece = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces[0], checksum = await checksumFile(statePath);
    assert.equal(piece.bytes, (await fs.stat(statePath)).size); assert.equal(piece.checksum, `${checksum.algo}:${checksum.value}`);
  }
  assert.deepEqual(JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces[1],
    { name: 'unrelated', path: 'unrelated.json', bytes: 2, checksum: 'unchanged' });
  await assert.rejects(fs.stat(path.join(root, '.index_state.write.lock')), { code: 'ENOENT' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log(`Embedding state publication conflicts: ${selected}`);
