import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { wasmModule } from '../../helpers/wasm-fixture.js';
import { collectStandaloneWasm } from '../../../src/index/semantic/wasm/standalone.js';
import { retainedWasmSource } from '../../../src/index/semantic/wasm/retained-source.js';
import { executeWasmTask } from '../../../src/index/semantic/wasm/task-execution.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { readRetainedWasmSourceSnapshot } from '../../../src/semantic/retained-wasm-source-snapshot.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

// Authored coverage: no WASM instantiation, symlink creation or full index.
const { dir: root } = await prepareIsolatedTestCacheDir('wasm-retained-snapshot');
const bytes = wasmModule({ functions: [{ code: [0x20, 0] }], exports: [{ name: 'run', index: 0 }] });
const replacement = wasmModule({ functions: [{ code: [0x41, 1] }], exports: [{ name: 'run', index: 0 }] });
assert.equal(replacement.length, bytes.length);
const stagingRoot = path.join(root, 'semantic'), generation = { baseBuildId: 'wasm-snapshot', semanticRevision: 0 };
const policy = normalizeSemanticConfig({ enabled: true, enrichment: { bindings: 'off', localFlow: 'deferred', crossFileFlow: 'off' } });
const diskAccount = createSemanticDiskAccount(8 * 1024 * 1024);
const initial = await collectStandaloneWasm({ bytes, relPath: 'module.wasm', repositoryNamespace: root, stagingRoot,
  storage: { generation, relativePath: 'semantic' }, diskAccount, policy });
const facts = initial.semanticFactsRef, sourceRows = [];
const store = createArtifactSemanticStore({ root: stagingRoot, repoRoot: root, generation,
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, partitions: facts.partitions });
for await (const row of store.iterateRows(facts.syntaxPartitionId, 'semantic_sources')) sourceRows.push(row);
assert.equal(sourceRows.length, 1);
const source = sourceRows[0], target = path.join(stagingRoot, 'semantic-sources', source.byteHash + '.utf8');
const originalOpen = fs.open, originalReadFile = fs.readFile, originalLstat = fsSync.lstatSync, cleanup = new Set();
const same = file => path.relative(path.resolve(String(file)), target) === '';
let control = {}, observations = [];
const run = signal => readRetainedWasmSourceSnapshot({ store, partitionId: facts.syntaxPartitionId, source, signal });
const state = { semanticFactsByFile: new Map([['module.wasm', facts]]), semanticDiskAccount: diskAccount };
const runtime = { root, semanticPolicy: policy };
const item = { root: stagingRoot, generation, syntaxPartitions: facts.partitions,
  task: { sourceUnits: [source.sourceUnitId] }, sources: new Map([['module.wasm', source]]) };
try {
  fs.readFile = function (file, ...args) {
    assert.equal(same(file), false, 'retained binary bytes cannot use a second unbounded pathname read');
    return originalReadFile.call(fs, file, ...args);
  };
  fs.open = async (file, ...args) => {
    const handle = await originalOpen.call(fs, file, ...args);
    if (!same(file)) return handle;
    const nativeRead = handle.read, nativeClose = handle.close;
    const row = { reads: 0, bytes: 0, maxBuffer: 0, closes: 0 };
    observations.push(row); cleanup.add(() => nativeClose.call(handle));
    handle.read = async function (buffer, offset, length, position) {
      row.reads++; row.maxBuffer = Math.max(row.maxBuffer, buffer.length);
      if (control.readError) throw control.readError;
      const result = await nativeRead.call(handle, buffer, offset, Math.min(length, control.shortRead || length), position);
      row.bytes += result.bytesRead;
      if (row.reads === 1 && control.afterRead) await control.afterRead();
      return result;
    };
    handle.close = async function () {
      row.closes++;
      if (control.beforeClose) control.beforeClose();
      if (control.closeError) throw control.closeError;
      await nativeClose.call(handle);
      if (control.afterClose) control.afterClose();
    };
    return handle;
  };
  control = { shortRead: 3 };
  const captured = await run();
  assert.deepEqual(captured.bytes, bytes); assert.deepEqual(captured.source, source);
  assert.equal(createHash('sha256').update(captured.bytes).digest('hex'), source.byteHash);
  assert.equal(observations.length, 1); assert.equal(observations[0].bytes, bytes.length);
  assert.ok(observations[0].maxBuffer <= 65536); assert.equal(observations[0].closes, 1);
  const mutable = structuredClone(source);
  const retained = retainedWasmSource({ source: mutable, root: stagingRoot, store, syntaxPartitionId: facts.syntaxPartitionId });
  mutable.path = 'changed.wasm'; mutable.byteHash = '0'.repeat(64); mutable.lineStarts.push(1);
  assert.deepEqual(await retained.readBytes(), bytes); assert.equal(retained.source.path, 'module.wasm');
  assert.ok(Object.isFrozen(retained.source)); assert.ok(Object.isFrozen(retained.moduleRef));

  for (const change of [() => fs.writeFile(target, replacement), () => fs.appendFile(target, Buffer.alloc(4096)),
    () => fs.truncate(target, 8)]) {
    await fs.writeFile(target, bytes); observations = [];
    control = { shortRead: 3, afterRead: change };
    await assert.rejects(run(), error => ['ERR_FILE_CHANGED', 'ERR_FILE_INTEGRITY'].includes(error.code)
      && error.sourceUnitId === source.sourceUnitId && error.sourcePath === 'module.wasm'
      && error.partitionId === facts.syntaxPartitionId);
    assert.equal(observations.length, 1); assert.equal(observations[0].closes, 1);
    assert.ok(observations[0].maxBuffer <= 65536);
    assert.ok(observations[0].bytes <= bytes.length + 1);
  }
  await fs.writeFile(target, replacement); control = {};
  const beforeFacts = state.semanticFactsByFile.get('module.wasm');
  await assert.rejects(executeWasmTask({ state, runtime, item }), { code: 'ERR_FILE_INTEGRITY' });
  assert.equal(state.semanticFactsByFile.get('module.wasm'), beforeFacts);
  assert.equal(state.semanticEvidenceArtifacts, undefined, 'corruption is rejected before deferred collection/project publication');

  await fs.writeFile(target, bytes);
  const readError = Object.freeze(Object.assign(new Error('controlled WASM read'), { code: 'EIO' }));
  control = { readError };
  await assert.rejects(run(), error => error === readError || error.cause === readError);
  const closeError = Object.freeze(Object.assign(new Error('controlled WASM close'), { code: 'EIO' }));
  observations = []; control = { closeError };
  let failure;
  try { await run(); } catch (error) { failure = error; }
  assert.ok(failure?.cacheOwnershipPending);
  assert.equal(failure.sourceUnitId, source.sourceUnitId); assert.equal(failure.sourcePath, 'module.wasm');
  const pending = [failure], seen = new Set(); let session = null;
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); session ||= getContainedFileSession(value);
    pending.push(value.cause, ...(value.errors || []));
  }
  assert.ok(session);
  const reads = observations[0].reads; control = {};
  const released = await session.releaseAfterClose(); assert.equal(released.settled, true);
  assert.equal(observations[0].reads, reads, 'original-owner close recovery never rereads or decodes bytes');
  assert.equal(observations[0].closes, 2);

  const aborted = new AbortController(); aborted.abort(); observations = [];
  await assert.rejects(run(aborted.signal), { name: 'AbortError' }); assert.equal(observations.length, 0);
  const oversized = { ...source, byteLength: 65537 };
  const oversizeStore = { ...store, async *iterateRows() { yield oversized; } };
  await assert.rejects(readRetainedWasmSourceSnapshot({ store: oversizeStore, partitionId: facts.syntaxPartitionId }),
    { code: 'ERR_FILE_TOO_LARGE' });
  assert.equal(observations.length, 0, 'decoder allowance is checked before payload allocation/read');
  const lateAbort = new AbortController(); control = { afterClose: () => lateAbort.abort() };
  await assert.rejects(run(lateAbort.signal), { name: 'AbortError' });
  const midAbort = new AbortController(); observations = [];
  control = { shortRead: 3, afterRead: () => midAbort.abort() };
  await assert.rejects(executeWasmTask({ state, runtime, item, signal: midAbort.signal }), { name: 'AbortError' });
  assert.equal(observations.length, 1); assert.equal(observations[0].closes, 1);
  assert.equal(state.semanticFactsByFile.get('module.wasm'), beforeFacts);
  assert.equal(state.semanticEvidenceArtifacts, undefined, 'capture interruption precedes deferred decode/staging');
  const whileClosing = new AbortController(); observations = [];
  control = { beforeClose: () => whileClosing.abort(), closeError };
  let closingFailure;
  try { await executeWasmTask({ state, runtime, item, signal: whileClosing.signal }); } catch (error) { closingFailure = error; }
  assert.ok(closingFailure?.cacheOwnershipPending);
  assert.equal(state.semanticFactsByFile.get('module.wasm'), beforeFacts);
  assert.equal(state.semanticEvidenceArtifacts, undefined);
  const stack = [closingFailure], inspected = new Set(); let closeSession;
  while (stack.length) {
    const error = stack.pop(); if (!error || typeof error !== 'object' || inspected.has(error)) continue;
    inspected.add(error); closeSession ||= getContainedFileSession(error); stack.push(error.cause, ...(error.errors || []));
  }
  assert.ok(closeSession); const readsBeforeRecovery = observations[0].reads; control = {};
  assert.equal((await closeSession.releaseAfterClose()).settled, true);
  assert.equal(observations[0].reads, readsBeforeRecovery, 'late cancellation cannot cause replacement-owner reread or decode');
  observations = [];
  fsSync.lstatSync = function (file, ...args) {
    const stat = originalLstat.call(fsSync, file, ...args);
    return same(file) ? { ...stat, isSymbolicLink: () => true } : stat;
  };
  await assert.rejects(run(), { code: 'ERR_UNSAFE_FILE_PATH' });
  assert.equal(observations.length, 0, 'an injected symlink-kind observation is refused without opening bytes');
  fsSync.lstatSync = originalLstat;
  const displaced = target + '.captured-original';
  observations = []; control = { shortRead: 3, afterRead: async () => {
    await fs.rename(target, displaced); await fs.writeFile(target, replacement);
  } };
  try {
    const snapshot = await run(); assert.deepEqual(snapshot.bytes, bytes, 'a borrowed descriptor may only return its original verified snapshot');
  } catch (error) { assert.ok(['ERR_FILE_CHANGED', 'ERR_FILE_INTEGRITY', 'ERR_UNSAFE_FILE_PATH'].includes(error.code)); }
  finally { await fs.unlink(target); await fs.rename(displaced, target); }
  assert.equal(observations.length, 1); assert.equal(observations[0].closes, 1);
  assert.ok(observations[0].maxBuffer <= 65536);
  control = {};
  const result = await executeWasmTask({ state, runtime, item });
  assert.ok(result.partitions.length > 0); assert.equal(state.semanticFactsByFile.get('module.wasm').sourceHash, source.byteHash);
} finally {
  fs.open = originalOpen; fs.readFile = originalReadFile; fsSync.lstatSync = originalLstat;
  for (const close of cleanup) { try { await close(); } catch {} }
}
console.log('retained WASM snapshot capture and producer handoff passed');
