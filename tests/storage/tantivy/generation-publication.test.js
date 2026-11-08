import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildTantivyGeneration } from '../../../tools/build/tantivy-generation.js';
import { createTantivySource, readTantivyManifest, tantivySourceKey } from '../../../src/shared/tantivy-source.js';
import { readTantivyReceipt } from '../../../src/shared/tantivy-receipt.js';
import { resolveTantivyPaths } from '../../../src/shared/tantivy.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess } from '../../../src/shared/storage/access.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writeTantivySourceFixture, writeTantivyPayloadFixture } from '../../helpers/tantivy-generation.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('generation-publication/')[1];
const cases = ['mapping', 'manifest', 'repository', 'payload', 'failed-build', 'cancelled-build',
  'concurrent-builds', 'mutated-input', 'source-lease', 'pending-build', 'legacy-metadata', 'activation-failure',
  'returned-pending', 'returned-capture', 'returned-unreadable', 'returned-revoked', 'returned-error',
  'returned-settled', 'promise-pending', 'promise-rejected', 'legacy-build-contract'];
assert.ok(cases.includes(selected));
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./generation-publication.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases });
const { dir } = await prepareIsolatedTestCacheDir(`tantivy-publication-${selected}`);
const repoRoot = path.join(dir, 'repo'), cache = path.join(dir, 'cache'), home = path.join(dir, 'home');
await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, repo = resolveRepoCacheRootPath(repoRoot, userConfig);
const indexDir = path.join(repo, 'builds', 'selected', 'index-code'), config = { path: path.join(repo, 'shared-tantivy') };
let idx = await writeTantivySourceFixture(indexDir);
const options = { repoRoot, indexDir, mode: 'code', config, userConfig, buildIndex: writeTantivyPayloadFixture };
const source = async (overrides = {}) => createTantivySource({ repoRoot, indexDir, mode: 'code',
  manifestSha256: (await readTantivyManifest(indexDir, { repoRoot })).sha256,
  chunkMeta: idx.chunkMeta, tokenPostings: idx.tokenIndex, ...overrides });
const admit = async (overrides = {}) => readTantivyReceipt({ ...options, source: await source(), ...overrides });
const paths = resolveTantivyPaths(indexDir, 'code', config), coordinationRoot = path.join(home, 'state', 'storage-access');
const protectedSource = async expected => {
  for (const root of [cache, path.join(cache, 'repos'), repo, indexDir]) {
    assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected, root);
  }
};
const first = await buildTantivyGeneration(options);
assert.equal(first.available, true); assert.equal((await admit()).available, true);
await protectedSource(false);
if (selected === 'mapping') {
  const swapped = await source({ chunkMeta: [...idx.chunkMeta].reverse() });
  assert.equal(swapped.chunkCount, first.meta.source.chunkCount);
  assert.equal(swapped.manifestSha256, first.meta.source.manifestSha256);
  assert.notEqual(swapped.documentMappingSha256, first.meta.source.documentMappingSha256);
  assert.equal((await admit({ source: swapped })).reason, 'source-identity-mismatch');
  const replaced = structuredClone(idx.tokenIndex); replaced.postings = [[[1, 2]]];
  assert.equal((await admit({ source: await source({ tokenPostings: replaced }) })).reason, 'source-identity-mismatch');
} else if (selected === 'manifest') {
  idx = await writeTantivySourceFixture(indexDir, { buildId: 'source-B' });
  assert.equal((await admit()).reason, 'source-identity-mismatch');
} else if (selected === 'repository') {
  assert.equal((await admit({ source: await source({ repoRoot: path.join(dir, 'different-repository') }) })).reason, 'source-identity-mismatch');
} else if (selected === 'payload') {
  await fs.writeFile(path.join(first.dir, 'native-protocol-fixture.json'), '["swapped"]');
  assert.equal((await admit()).reason, 'payload-identity-mismatch');
} else if (selected === 'legacy-metadata') {
  await fs.writeFile(paths.metaPath, JSON.stringify({ ...first.meta, schemaVersion: 1 }));
  assert.equal((await admit()).reason, 'missing-or-incompatible-metadata');
} else if (selected === 'legacy-build-contract') {
  const legacy = structuredClone(first.meta.source);
  legacy.contract.version = 1; delete legacy.contract.buildSettlement;
  await fs.writeFile(paths.metaPath, JSON.stringify({ ...first.meta, source: legacy, sourceKey: tantivySourceKey(legacy) }));
  assert.equal((await admit()).reason, 'source-identity-mismatch');
  const rebuilt = await buildTantivyGeneration(options);
  assert.equal(rebuilt.reused, false, 'old native build settlement meaning requires a fresh publication');
  assert.notEqual(rebuilt.dir, first.dir);
  assert.equal((await admit()).available, true);
} else {
  // A distinct full source requires a real build, rather than reusing A's receipt.
  idx = await writeTantivySourceFixture(indexDir, { buildId: 'source-B' });
  const originalPointer = await fs.readFile(paths.metaPath, 'utf8');
  if (selected.startsWith('returned-') || selected.startsWith('promise-')) {
    let nativeSettled = ['returned-settled', 'returned-revoked', 'returned-error'].includes(selected);
    let armed = false, staging, returned;
    const original = Object.freeze(new Error(`original ${selected} native observation`));
    const open = fs.open;
    fs.open = async (file, ...args) => {
      if (armed && (selected === 'returned-error' && path.resolve(String(file)) === path.join(indexDir, 'pieces', 'manifest.json')
        || selected === 'returned-revoked' && path.resolve(String(file)) === path.join(staging, 'native-protocol-fixture.json'))) {
        nativeSettled = false;
        if (selected === 'returned-error') throw original;
      }
      return open(file, ...args);
    };
    const work = buildTantivyGeneration({ ...options, buildIndex: input => {
      staging = input.indexPath;
      if (selected.startsWith('promise-')) {
        returned = selected === 'promise-rejected' ? Promise.reject(original) : writeTantivyPayloadFixture(input);
        Object.defineProperties(returned, { cacheOwnershipPending: { value: true },
          cacheOwnershipReleased: { value: () => nativeSettled } });
        return returned;
      }
      return writeTantivyPayloadFixture(input).then(() => {
        armed = true;
        returned = { cacheOwnershipReleased: () => nativeSettled };
        if (selected === 'returned-capture') Object.defineProperty(returned, 'cacheOwnershipPending', {
          get() { returned.cacheOwnershipReleased = () => true; return true; }
        });
        else if (selected === 'returned-unreadable') Object.defineProperty(returned, 'cacheOwnershipPending', {
          get() { throw original; }
        });
        else returned.cacheOwnershipPending = true;
        return returned;
      });
    } });
    let failure;
    try {
      if (selected === 'returned-settled') assert.equal((await work).available, true);
      else await assert.rejects(work, error => { failure = error; return true; },
        'resolved output and promise settlement cannot certify outstanding original native work');
    } finally { fs.open = open; }
    if (selected === 'returned-settled') {
      assert.equal((await admit()).available, true);
      assert.notEqual(await fs.readFile(paths.metaPath, 'utf8'), originalPointer);
      await protectedSource(false);
    } else {
      assert.equal(await fs.readFile(paths.metaPath, 'utf8'), originalPointer);
      assert.equal((await admit()).available, false, 'the prior source cannot be relabeled as the requested generation');
      await protectedSource(true);
      assert.equal((await inspectStorageAccess(paths.dir, { coordinationRoot })).protected, true);
      assert.equal((await fs.stat(path.join(paths.dir, 'writer.lock'))).isFile(), true,
        'outstanding native work retains the original publication writer lock');
      assert.equal(failure.cacheOwnershipReleased(), false, 'the original native prerequisite remains live');
      const queue = [failure], seen = new Set();
      while (queue.length) {
        const error = queue.pop();
        if (!error || seen.has(error)) continue;
        seen.add(error); queue.push(error.cause, ...(Array.isArray(error.errors) ? error.errors : []));
      }
      if (['returned-unreadable', 'returned-error', 'promise-rejected'].includes(selected)) assert.ok(seen.has(original));
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(first.dir, 'native-protocol-fixture.json'), 'utf8')), ['alpha', 'beta']);
      // No native writer exists in this protocol control. Changing its witness
      // does not claim recovery of the retained original leases or writer lock.
      nativeSettled = true;
    }
  } else if (selected === 'activation-failure') {
    const rename = fs.rename;
    const error = Object.freeze(Object.assign(new Error('receipt activation failed'), { code: 'EIO' }));
    fs.rename = async (from, to) => { if (to === paths.metaPath) throw error; return rename(from, to); };
    try {
      await assert.rejects(buildTantivyGeneration(options), { code: 'ERR_ATOMIC_WRITE' });
    } finally { fs.rename = rename; }
    assert.equal(await fs.readFile(paths.metaPath, 'utf8'), originalPointer);
    assert.equal((await buildTantivyGeneration(options)).available, true);
  } else if (selected === 'failed-build') {
    const error = Object.freeze(new Error('native staging failed after partial output'));
    let staging;
    await assert.rejects(buildTantivyGeneration({ ...options, buildIndex: async input => {
      staging = input.indexPath; await writeTantivyPayloadFixture(input); throw error;
    } }), value => value === error);
    assert.notEqual(staging, first.dir);
    assert.equal(await fs.readFile(paths.metaPath, 'utf8'), originalPointer);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(first.dir, 'native-protocol-fixture.json'), 'utf8')), ['alpha', 'beta']);
    assert.equal((await buildTantivyGeneration(options)).available, true, 'a later invocation can publish without mutating or deleting abandoned staging');
  } else if (selected === 'cancelled-build') {
    const abort = new AbortController(); let released, ready;
    const gate = new Promise(resolve => { released = resolve; }), started = new Promise(resolve => { ready = resolve; });
    let ended = false;
    const work = buildTantivyGeneration({ ...options, signal: abort.signal, buildIndex: async input => {
      await writeTantivyPayloadFixture(input); ready(); await gate;
    } }).finally(() => { ended = true; });
    const drained = work.catch(() => {});
    try { await started; abort.abort(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(ended, false); await protectedSource(true);
    } finally { released(); await drained; }
    await assert.rejects(work, { code: 'ABORT_ERR' });
    assert.equal(await fs.readFile(paths.metaPath, 'utf8'), originalPointer);
  } else if (selected === 'concurrent-builds') {
    let builds = 0;
    const buildIndex = async input => { builds++; await new Promise(resolve => setImmediate(resolve)); await writeTantivyPayloadFixture(input); };
    const completed = await Promise.allSettled([buildTantivyGeneration({ ...options, buildIndex }), buildTantivyGeneration({ ...options, buildIndex })]);
    for (const result of completed) assert.equal(result.status, 'fulfilled', result.reason?.message);
    const results = completed.map(result => result.value);
    assert.equal(builds, 1); assert.equal(results[0].dir, results[1].dir);
    assert.equal(results.filter(result => result.reused).length, 1);
  } else if (selected === 'mutated-input') {
    await assert.rejects(buildTantivyGeneration({ ...options, buildIndex: async input => {
      await writeTantivyPayloadFixture(input); input.chunkMeta.reverse();
    } }), { code: 'ERR_TANTIVY_PUBLICATION' });
    assert.equal(await fs.readFile(paths.metaPath, 'utf8'), originalPointer);
  } else if (selected === 'source-lease') {
    await buildTantivyGeneration({ ...options, buildIndex: async input => {
      await protectedSource(true);
      assert.equal((await inspectStorageAccess(paths.dir, { coordinationRoot })).protected, true);
      await writeTantivyPayloadFixture(input);
    } });
  } else if (selected === 'pending-build') {
    let settled = false;
    const original = Object.freeze(Object.assign(new Error('native writer is still outstanding'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => settled
    }));
    let error;
    await assert.rejects(buildTantivyGeneration({ ...options, buildIndex: () => { throw original; } }), value => { error = value; return true; });
    await protectedSource(true);
    assert.equal(await fs.readFile(paths.metaPath, 'utf8'), originalPointer);
    assert.ok(error, 'unknown native work is retained as a failure, not counted as a published generation');
    // This controlled fixture has no native writer. Do not manufacture recovery
    // of the retained publication lock or claim those resource leases released.
    settled = true;
  }
  if (selected !== 'pending-build' && !selected.startsWith('returned-') && !selected.startsWith('promise-')) await protectedSource(false);
}
console.log(`Tantivy generation publication ${selected}: deterministic protocol fixture, no native qualification.`);
