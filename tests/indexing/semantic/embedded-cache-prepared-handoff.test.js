import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId, semanticHash } from '../../../src/index/semantic/identity.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { persistSemanticEvidence } from '../../../src/index/semantic/lsp-evidence.js';
import { persistSemanticCacheEntry } from '../../../src/index/build/incremental/semantic-cache.js';
import { relocateEmbeddedSemanticCacheEntries } from '../../../src/index/semantic/embedded-cache.js';
import { createSemanticReplayVerificationContext } from '../../../src/index/build/incremental/verified-replay.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { prepareCachedSemanticPlan } from '../../../src/storage/sqlite/semantic/from-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';
import { semanticPreparedSourceAdmissionFor } from '../../../src/index/semantic/planning.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/semantic/embedded-cache-prepared-handoff/')[1];
assert.ok(['siblings-1', 'siblings-4', 'siblings-16', 'zero-children', 'qualification-guards',
  'changed-child-inventory', 'destination-copy-failure', 'cancel-between-children'].includes(mode));
const count = mode.startsWith('siblings-') ? Number(mode.split('-')[1]) : mode === 'zero-children' ? 0 : mode === 'cancel-between-children' ? 2 : 1;
const localText = 'const value = "é😀";\r\n', unit = '<script>' + localText + '</script>\r\n';
const fixture = await createRecoveryFixture(unit.repeat(Math.max(1, count)));
const storage = { generation: fixture.generation, relativePath: 'semantic' }, dependencySignatures = { semantic: 'a'.repeat(64) };
const bundleDir = path.join(fixture.root, 'bundle'), targetBuildRoot = path.join(fixture.root, 'warm');
const entries = [], originals = [], open = fs.open, stat = fs.stat, copyFile = fs.copyFile, readFile = fs.readFile;
let lock, lease, verification;
try {
  await fs.mkdir(bundleDir); await fs.mkdir(targetBuildRoot);
  const parentPart = await fixture.write([]);
  const parentFacts = createSemanticFactsRef({ source: fixture.source, partitions: [parentPart],
    syntaxPartitionId: parentPart.partitionId, storage, coverage: [] });
  const persist = factsRef => persistSemanticCacheEntry({ repoRoot: fixture.root, bundleDir, buildRoot: fixture.root,
    factsRef, dependencySignatures, diskAccount: fixture.account });
  const parentLocator = await persist(parentFacts);
  for (let index = 0; index < count; index++) {
    const segmentUid = 'segment-' + index, start = index * unit.length + 8;
    const map = { schemaVersion: 1, kind: 'embedded-linear-range', quality: 'exact',
      parentSourceUnitId: fixture.source.sourceUnitId, parentByteHash: fixture.source.byteHash,
      parentStart: start, parentEnd: start + localText.length, localStart: 0, localEnd: localText.length,
      coordinateUnit: 'utf16', segmentUid, language: 'typescript' };
    const identity = semanticHash('semantic.embedded-map.v1', map);
    const mapRef = await persistSemanticEvidence({ value: map, stagingRoot: fixture.stagingRoot, diskAccount: fixture.account, inventory: [] });
    const source = createSemanticSourceSnapshot({ bytes: Buffer.from(localText), repositoryNamespace: fixture.root,
      path: 'original.js.semantic-segments/' + identity + '.ts', language: 'typescript',
      mapping: { identity, parentSourceUnitId: fixture.source.sourceUnitId, mapRef, quality: 'exact' } });
    const partitionId = createSyntaxPartitionId({ sourceUnitId: source.manifest.sourceUnitId,
      parser: { family: 'embedded-handoff-fixture', version: '1', options: {} },
      extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: {} });
    const partition = await fixture.write([], { source: source.manifest, sourceBytes: Buffer.from(localText),
      sourceCapability: source.sourceCapability, partitionId });
    const factsRef = createSemanticFactsRef({ source: source.manifest, partitions: [partition], syntaxPartitionId: partitionId, storage, coverage: [] });
    entries.push({ segmentUid, locator: await persist(factsRef) }); originals.push(factsRef);
  }
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, semanticEnabled: true,
    semanticGeneration: fixture.generation, semanticDependencySignatures: dependencySignatures,
    files: { 'original.js': { semanticCache: parentLocator, semanticSegmentCaches: entries } } };
  const sqliteMetrics = {};
  let parentOpens = 0;
  const parentFile = path.toNamespacedPath(path.join(bundleDir, 'semantic', parentLocator.cacheKey, 'parts', 'semantic-sources', fixture.source.byteHash + '.utf8'));
  const countParent = filename => { if (typeof filename === 'string' && path.toNamespacedPath(filename) === parentFile) parentOpens++; };
  if (!count) {
    fs.open = async (filename, ...args) => { countParent(filename); return open(filename, ...args); };
    fs.readFile = async (filename, ...args) => { countParent(filename); return readFile(filename, ...args); };
  }
  let plan;
  try { plan = await prepareCachedSemanticPlan({ repoRoot: fixture.root, incrementalData: { bundleDir, manifest }, diskAccount: fixture.account, metrics: sqliteMetrics }); }
  finally { fs.open = open; fs.readFile = readFile; }
  if (!count) assert.equal(parentOpens, 1, 'zero children retain exactly the ordinary parent verification without an extra embedded-only parent read');
  assert.equal(plan.entries.length, count + 1); assert.equal(plan.partitions.length, count + 1);
  assert.equal(sqliteMetrics.parentHashes || 0, count ? 1 : 0);
  assert.equal(sqliteMetrics.parentDecodes || 0, count ? 1 : 0);
  assert.equal(sqliteMetrics.childDescriptorOpens || 0, count);
  assert.equal(new Set(plan.entries.map(entry => entry.factsRef.sourceUnitId)).size, count + 1,
    'equal local text retains distinct segment identities');
  lock = await acquireIndexLock({ repoCacheRoot: path.join(fixture.root, 'writer-cache'), requireSettlement: true }); assert.ok(lock);
  lease = createIndexCacheLease(lock, path.join(fixture.root, 'writer-cache'));
  verification = createSemanticReplayVerificationContext({ bundleDir, maxBytes: 4 * 1024 * 1024, lease });
  const metrics = {}, options = { entries, parentFacts, parentBytes: fixture.bytes, repoRoot: fixture.root,
    bundleDir, dependencySignatures, targetBuildRoot, storage: { ...storage, generation: { baseBuildId: 'warm', semanticRevision: 0 } },
    diskAccount: fixture.account, replayVerification: verification, metrics };
  if (mode === 'qualification-guards') {
    await assert.rejects(relocateEmbeddedSemanticCacheEntries({ ...options, replayVerification: { verifyEmbedded() { assert.fail('forged context must not execute'); } } }), /original semantic replay context/);
    await assert.rejects(relocateEmbeddedSemanticCacheEntries({ ...options, parentFacts: { ...parentFacts, sourceHash: 'f'.repeat(64) } }), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
    await assert.rejects(relocateEmbeddedSemanticCacheEntries({ ...options, parentFacts: { ...parentFacts, repositoryNamespace: 'other-world' } }), { code: 'ERR_SEMANTIC_CACHE_MISMATCH' });
    await assert.rejects(relocateEmbeddedSemanticCacheEntries({ ...options, dependencySignatures: { semantic: 'b'.repeat(64) } }), { code: 'ERR_SEMANTIC_CACHE_MISMATCH' });
    await assert.rejects(relocateEmbeddedSemanticCacheEntries({ ...options, entries: [{ ...entries[0], segmentUid: 'wrong-segment' }] }), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
    const beforeDuplicate = fixture.account.used;
    await assert.rejects(relocateEmbeddedSemanticCacheEntries({ ...options, entries: [entries[0], entries[0]] }), /Duplicate embedded cache source/);
    assert.equal(fixture.account.used - beforeDuplicate,
      (await reopenSemanticDiskAccount({ roots: [targetBuildRoot], limit: Number.MAX_SAFE_INTEGER })).retainedBytes,
      'a rejected duplicate keeps the first admitted child physically accounted');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(relocateEmbeddedSemanticCacheEntries({ ...options, signal: controller.signal }), /abort/i);
    verification.clear();
    await assert.rejects(relocateEmbeddedSemanticCacheEntries(options), /active original semantic replay context/);
    verification = createSemanticReplayVerificationContext({ bundleDir, maxBytes: 4 * 1024 * 1024, lease });
    lease.invalidate();
    await assert.rejects(relocateEmbeddedSemanticCacheEntries({ ...options, replayVerification: verification }), { code: 'ERR_INDEX_CACHE_OWNERSHIP' });
    assert.equal(semanticPreparedSourceAdmissionFor(fixture.account).used, 0);
  } else if (['changed-child-inventory', 'destination-copy-failure', 'cancel-between-children'].includes(mode)) {
    const before = fixture.account.used, controller = new AbortController(); let changed = false, descriptorStats = 0;
    if (mode === 'changed-child-inventory') fs.stat = async (filename, ...args) => {
      if (typeof filename === 'string' && filename.endsWith(path.sep + 'descriptor.json') && filename.includes(entries[0].locator.cacheKey)) {
        descriptorStats++;
        if (descriptorStats === 3) {
          changed = true;
          const partRoot = path.join(bundleDir, 'semantic', entries[0].locator.cacheKey, 'parts');
          const maps = await fs.readdir(path.join(partRoot, 'semantic-evidence'));
          await fs.appendFile(path.join(partRoot, 'semantic-evidence', maps[0]), ' ');
        }
      }
      return stat(filename, ...args);
    };
    const primary = Object.freeze(Object.assign(new Error('original destination copy failed'), { code: 'EIO' }));
    if (mode === 'destination-copy-failure') fs.copyFile = async (from, to, ...args) => {
      if (path.relative(path.toNamespacedPath(targetBuildRoot), path.toNamespacedPath(to)).startsWith('semantic' + path.sep)) { changed = true; throw primary; }
      return copyFile(from, to, ...args);
    };
    if (mode === 'cancel-between-children') fs.open = async (filename, ...args) => {
      if (typeof filename === 'string' && filename.endsWith(path.sep + 'descriptor.json') && filename.includes(entries[1].locator.cacheKey)) {
        changed = true; controller.abort();
      }
      return open(filename, ...args);
    };
    let failed = false, failure;
    try { await relocateEmbeddedSemanticCacheEntries({ ...options, signal: controller.signal }); } catch (error) { failed = true; failure = error; }
    fs.open = open; fs.stat = stat; fs.copyFile = copyFile;
    assert.equal(changed, true, 'the intended real read/copy boundary was reached'); assert.equal(failed, true);
    if (mode === 'destination-copy-failure') assert.equal(failure, primary);
    if (mode === 'cancel-between-children') assert.match(failure.message, /abort/i);
    const retained = (await reopenSemanticDiskAccount({ roots: [targetBuildRoot], limit: Number.MAX_SAFE_INTEGER })).retainedBytes;
    assert.equal(fixture.account.used - before, retained, 'failure cannot refund retained output or charge already removed staging twice');
    assert.equal(semanticPreparedSourceAdmissionFor(fixture.account).used, 0);
  } else {
    const before = fixture.account.used, beforeDisk = (await reopenSemanticDiskAccount({ roots: [targetBuildRoot], limit: Number.MAX_SAFE_INTEGER })).retainedBytes;
    let descriptorOpens = 0;
    fs.open = async (filename, ...args) => {
      if (typeof filename === 'string' && filename.endsWith(path.sep + 'descriptor.json')) descriptorOpens++;
      return open(filename, ...args);
    };
    let relocated;
    try { relocated = await relocateEmbeddedSemanticCacheEntries(options); } finally { fs.open = open; }
    assert.equal(descriptorOpens, count, 'each leased child opens its descriptor once across qualification and relocation');
    assert.equal(metrics.parentHashes || 0, count ? 1 : 0); assert.equal(metrics.parentDecodes || 0, count ? 1 : 0);
    assert.equal(verification.metrics.childDescriptorOpens, count);
    assert.equal(verification.metrics.childMapReads, count);
    assert.equal(verification.metrics.consumedReplays, count);
    assert.equal(relocated.semanticSegmentFactsRefs.length, count);
    assert.deepEqual(relocated.semanticSegmentFactsRefs.map(entry => entry.factsRef.partitions.map(partition => partition.canonicalHash)),
      originals.map(entry => entry.partitions.map(partition => partition.canonicalHash)));
    const afterDisk = (await reopenSemanticDiskAccount({ roots: [targetBuildRoot], limit: Number.MAX_SAFE_INTEGER })).retainedBytes;
    assert.equal(fixture.account.used - before, afterDisk - beforeDisk, 'copy credits follow actual retained physical output');
    assert.equal(semanticPreparedSourceAdmissionFor(fixture.account).used, 0);
  }
} finally {
  fs.open = open; fs.stat = stat; fs.copyFile = copyFile; fs.readFile = readFile;
  verification?.clear(); lease?.invalidate(); if (lock) await lock.release(); await fixture.cleanup();
}
