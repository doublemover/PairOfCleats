import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { readCachedBundle, readCachedImports } from '../../../src/index/build/incremental/state-reconciliation.js';
import { preloadFileCompletions } from '../../../src/index/build/incremental/file-completion.js';
import { loadCachedBundleForFile } from '../../../src/index/build/file-processor/incremental.js';
import { writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { writeIncrementalBundle } from '../../../src/index/build/incremental/writeback.js';
import { collectLanguageImports } from '../../../src/index/language-registry.js';
import { getImportExtraction } from '../../../src/shared/import-extraction.js';
import { preprocessFiles } from '../../../src/index/build/preprocess.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/incremental/source-caller-authority/')[1];
assert.ok(['completion', 'semantic', 'nonsemantic', 'imports', 'missing-semantic', 'missing-checkpoint', 'prefix'].includes(selected));
const fixture = await createSemanticCacheFixture();
const text = '// ' + 'source identity '.repeat(6000) + '\nf(1);\n';
const file = await fixture.createFile({ text }), abs = path.join(fixture.repoRoot, file.file);
const external = path.join(fixture.root, 'outside.js'); await fs.writeFile(external, file.bytes);
const hash = algorithm => createHash(algorithm).update(file.bytes).digest('hex');
const originalOpen = fs.open, originalLstat = nativeFs.lstatSync, originalStat = nativeFs.statSync;
const retained = new Map(), observations = [];
let sharedReadState = new Map(), sourceStat = await fs.stat(abs);
let checkpointEntry = null;
const checkpoint = { chunks: [{ start: 0, end: text.length }], diagnostics: {}, textLength: text.length };
const { ignoreMatcher } = await buildIgnoreMatcher({ root: fixture.repoRoot, userConfig: {} });
const context = signal => ({ repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot,
  dependencySignatures: fixture.dependencies, diskAccount: fixture.account,
  buildRoot: fixture.buildRoot, storage: fixture.storage, signal });
const invoke = async signal => {
  const semanticContext = context(signal);
  const state = { enabled: true, bundleDir: fixture.bundleDir, bundleFormat: 'json', readHashCache: sharedReadState,
    manifest: { ...fixture.manifest, files: { ...fixture.manifest.files } } };
  const input = { repoRoot: fixture.repoRoot, enabled: true, absPath: abs, relKey: file.file, fileStat: sourceStat,
    manifest: state.manifest, bundleDir: fixture.bundleDir, sharedReadState, signal };
  if (selected === 'completion') {
    state.manifest.files = {};
    const completed = await preloadFileCompletions({ entries: [{ abs, rel: file.file, stat: sourceStat }],
      incrementalState: state, semanticContext });
    return { accepted: completed.has(abs), receipt: state.manifest.files[file.file] };
  }
  if (selected === 'missing-semantic' || selected === 'missing-checkpoint') {
    state.manifest.files = selected === 'missing-semantic' ? {} : { [file.file]: checkpointEntry };
    const result = await loadCachedBundleForFile({ repoRoot: fixture.repoRoot, runIo: action => action(),
      incrementalState: state, absPath: abs, relKey: file.file, fileStat: sourceStat,
      ...(selected === 'missing-semantic' ? { semanticContext } : {}), signal });
    return { accepted: Boolean(result.cachedBundle || result.parseCheckpointFallback), ...result };
  }
  if (selected === 'imports') {
    const imports = await readCachedImports(input);
    return { accepted: imports !== null, imports };
  }
  if (selected === 'prefix') {
    const result = await preprocessFiles({ root: fixture.repoRoot, modes: ['code'], ignoreMatcher,
      lineCounts: false, snapshotCache: null, concurrency: 1, abortSignal: signal,
      fileScan: { sampleBytes: 128, binary: { sampleMinBytes: 1 }, minified: { sampleMinBytes: 0 } } });
    return { accepted: result.entriesByMode.code.some(entry => entry.rel === file.file), result };
  }
  const result = await readCachedBundle({ ...input, ...(selected === 'semantic' ? { semanticContext } : {}) });
  return { accepted: Boolean(result.cachedBundle), ...result };
};
const install = ({ fault = null, controller = null, primary = null, secondary = null } = {}) => {
  let changed = false, denyClose = Boolean(secondary);
  const states = [];
  nativeFs.lstatSync = function (filename, ...args) {
    const stat = originalLstat.call(this, filename, ...args);
    return fault === 'nested-link' && path.resolve(String(filename)) === fixture.repoRoot
      ? Object.create(stat, { isSymbolicLink: { value: () => true } }) : stat;
  };
  nativeFs.statSync = function (filename, ...args) {
    // Windows prohibits renaming over this original open handle. Substitute
    // only the fresh pathname metadata with another actual file's identity;
    // the original admitted FD/read/close remain real and unchanged.
    const actual = fault === 'replacement' && changed && path.resolve(String(filename)) === abs
      ? abs + '.replacement' : filename;
    return originalStat.call(this, actual, ...args);
  };
  fs.open = async (filename, ...args) => {
    if (path.resolve(String(filename)) !== abs) return originalOpen(filename, ...args);
    if (fault === 'delete-before-open' && !changed) { changed = true; await fs.unlink(abs); }
    const actual = fault === 'same-bytes-external' ? external : filename;
    const handle = await originalOpen(actual, ...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
    const state = { fault, handle, actual: path.resolve(String(actual)), bytes: 0, reads: 0, closes: 0, content: [], windows: [] };
    states.push(state); retained.set(handle, close);
    handle.read = async (buffer, offset, length, position) => {
      state.reads++; state.windows.push(length);
      if (primary) throw primary;
      const value = fault === 'premature-eof' ? { bytesRead: 0, buffer }
        : await read(buffer, offset, fault === 'short-read' ? Math.min(1024, length) : length, position);
      state.bytes += value.bytesRead; state.content.push(Buffer.from(buffer.subarray(offset, offset + value.bytesRead)));
      if (!changed) {
        changed = true;
        if (fault === 'replacement') {
          const replacement = abs + '.replacement'; await fs.writeFile(replacement, file.bytes);
          assert.notEqual(originalStat(abs, { bigint: true }).ino, originalStat(replacement, { bigint: true }).ino);
        } else if (fault === 'growth') await fs.appendFile(abs, ' ');
        else if (fault === 'truncate') await fs.truncate(abs, 1);
        else if (fault === 'rewrite') {
          const bytes = Buffer.from(file.bytes); bytes[bytes.length - 2] = 32; await fs.writeFile(abs, bytes);
        } else if (fault === 'abort-read') controller.abort();
      }
      return value;
    };
    handle.close = async () => {
      state.closes++; if (denyClose) throw secondary;
      await close(); retained.delete(handle);
      if (fault === 'abort-closed') controller.abort();
    };
    return handle;
  };
  return { states, release: () => { denyClose = false; } };
};
const reset = async () => {
  fs.open = originalOpen; nativeFs.lstatSync = originalLstat; nativeFs.statSync = originalStat;
  await fs.rm(abs + '.replacement', { force: true });
  await fs.writeFile(abs, file.bytes); sourceStat = await fs.stat(abs); sharedReadState = new Map();
};
const assertClosed = states => { for (const state of states) {
  assert.equal(state.handle.fd, -1, `${selected}/${state.fault || 'healthy'}: the original descriptor is closed`);
  assert.equal(state.closes, 1, `${selected}/${state.fault || 'healthy'}: exactly one original close`);
} };
const healthy = async (fault = null) => {
  const { states } = install({ fault }); const result = await invoke();
  assert.equal(result.accepted, true, selected); assertClosed(states);
  const actualBytes = Buffer.concat(states.flatMap(state => state.content));
  assert.ok(actualBytes.length > 0, 'the real caller exercised the owned source read');
  if (selected !== 'prefix') {
    assert.deepEqual(actualBytes, file.bytes, 'one exact source payload, without a second hashing stream');
    assert.equal(createHash('sha1').update(actualBytes).digest('hex'), hash('sha1'));
    assert.equal(createHash('sha256').update(actualBytes).digest('hex'), file.source.byteHash);
    if (result.buffer) assert.deepEqual(result.buffer, file.bytes);
    if (result.semanticFactsRef) assert.equal(result.semanticFactsRef.sourceHash, file.source.byteHash);
    if (result.parseCheckpointFallback) {
      assert.equal(result.parseCheckpointFallback.sourceHash, hash('sha1'));
      assert.deepEqual(result.parseCheckpointFallback.checkpoint, checkpoint);
    }
    if (result.receipt) assert.equal(result.receipt.semanticCache.sourceUnitId, file.source.sourceUnitId);
  } else {
    assert.deepEqual(actualBytes, file.bytes.subarray(0, actualBytes.length), 'bounded prefix is exact; no full-source digest claimed');
    assert.ok(actualBytes.length <= 8192);
  }
  observations.push({ fault: fault || 'healthy', opens: states.length, payloadBytes: actualBytes.length,
    sha1: createHash('sha1').update(actualBytes).digest('hex'), sha256: createHash('sha256').update(actualBytes).digest('hex') });
  fs.open = originalOpen; return result;
};
try {
  if (selected === 'imports') {
    const imports = collectLanguageImports({ text, ext: '.js', relPath: file.file, mode: 'code' });
    const entry = await writeIncrementalBundle({ enabled: true, bundleDir: fixture.bundleDir, relKey: file.file,
      fileStat: sourceStat, fileHash: hash('sha1'), fileChunks: file.chunks,
      dependencySignatures: fixture.dependencySignatures,
      fileRelations: { imports, importExtraction: getImportExtraction(imports) }, bundleFormat: 'json' });
    Object.assign(file.entry, entry);
  }
  if (selected === 'missing-checkpoint') {
    const bundle = { artifactSurfaceVersion: fixture.manifest.artifactSurfaceVersion, file: file.file,
      hash: hash('sha1'), size: sourceStat.size, mtimeMs: sourceStat.mtimeMs,
      dependencySignatures: fixture.dependencySignatures, parseCheckpoint: checkpoint, chunks: file.chunks };
    const snapshot = await writeIncrementalBundleSnapshot({ repoRoot: fixture.repoRoot, bundleDir: fixture.bundleDir,
      relKey: file.file, bundles: [bundle] });
    checkpointEntry = { ...snapshot, hash: hash('sha1'), size: sourceStat.size, mtimeMs: sourceStat.mtimeMs,
      dependencySignatures: fixture.dependencySignatures };
    await fs.unlink(path.join(fixture.bundleDir, snapshot.bundles[0]));
  }
  // Refresh only the fixture's saved stat observation after restoration. The
  // source content/hash and all immutable bundle/checkpoint bytes stay fixed.
  const alignEntry = () => {
    Object.assign(file.entry, { size: sourceStat.size, mtimeMs: sourceStat.mtimeMs });
    if (checkpointEntry) Object.assign(checkpointEntry, { size: sourceStat.size, mtimeMs: sourceStat.mtimeMs });
  };
  alignEntry(); await healthy(); await reset(); alignEntry(); await healthy('short-read');
  await reset(); alignEntry();
  for (const fault of ['replacement', 'same-bytes-external', 'nested-link', 'growth', 'truncate', 'rewrite', 'premature-eof', 'delete-before-open']) {
    const { states } = install({ fault });
    let result;
    try { result = await invoke(); }
    catch (error) { assert.ok(['ENOENT', 'ERR_UNSAFE_FILE_PATH', 'ERR_FILE_CHANGED', 'ERR_FILE_TOO_LARGE'].includes(error.code), fault + ': ' + error); }
    assert.notEqual(result?.accepted, true, fault + ': failed exact-source admission must not replay or classify the source');
    assertClosed(states);
    if (fault === 'same-bytes-external') assert.equal(states.reduce((sum, state) => sum + state.bytes, 0), 0);
    await reset(); alignEntry(); await healthy(); await reset(); alignEntry();
  }
  for (const fault of ['abort-before', 'abort-read', 'abort-closed']) {
    const controller = new AbortController(); if (fault === 'abort-before') controller.abort();
    const { states } = install({ fault, controller });
    await assert.rejects(invoke(controller.signal), error => error.code === 'ABORT_ERR' || error.name === 'AbortError', `${selected}/${fault}`);
    if (fault === 'abort-before') assert.equal(states.length, 0);
    assertClosed(states); await reset(); alignEntry();
  }
  for (const readFailure of [true, false]) {
    const primary = Object.freeze(new Error('original source read failure'));
    const secondary = Object.freeze(new Error('original source close failure'));
    const owner = install({ primary: readFailure ? primary : null, secondary });
    let failure; try { await invoke(); assert.fail('unsettled close must never be a cache miss'); } catch (error) { failure = error; }
    assert.equal(failure.cacheOwnershipReleased(), false);
    const seen = new Set(), queue = [failure];
    while (queue.length) { const error = queue.pop(); if (!error || seen.has(error)) continue; seen.add(error);
      if (error.cause) queue.push(error.cause); if (error.errors) queue.push(...error.errors); }
    assert.ok(seen.has(secondary)); if (readFailure) assert.ok(seen.has(primary));
    const source = owner.states[0], reads = source.reads;
    owner.release(); await getContainedFileSession(failure).releaseAfterClose();
    assert.equal(source.reads, reads); assert.equal(source.closes, 2); assert.equal(source.handle.fd, -1);
    assert.equal(failure.cacheOwnershipReleased(), true); await reset(); alignEntry();
  }
  if (['semantic', 'nonsemantic', 'imports'].includes(selected)) {
    const first = await healthy(); first.buffer?.fill(0);
    const { states } = install(); const warm = await invoke();
    assert.equal(warm.accepted, true); if (warm.buffer) assert.deepEqual(warm.buffer, file.bytes);
    assert.equal(states.reduce((sum, state) => sum + state.bytes, 0), 0, 'only the caller-bound private unchanged-source receipt reuses bytes');
    assert.ok(states.length > 0, 'cache reuse still reacquires exact contained identity'); assertClosed(states);
  }
  console.log(JSON.stringify({ caller: selected, observations,
    replacementScope: 'real held source descriptor versus independently created file identity at fresh pathname stat; no physical open-file rename claimed',
    physicalLinks: 'not qualified by metadata controls' }));
} finally {
  fs.open = originalOpen; nativeFs.lstatSync = originalLstat; nativeFs.statSync = originalStat;
  for (const close of retained.values()) await close(); await fixture.cleanup();
}
