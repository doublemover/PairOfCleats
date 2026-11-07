import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { createSemanticReplayVerificationContext } from '../../../src/index/build/incremental/verified-replay.js';
import { preloadFileCompletions } from '../../../src/index/build/incremental/file-completion.js';
import { loadCachedBundleForFile } from '../../../src/index/build/file-processor/incremental.js';
import { relocateSemanticCacheEntry } from '../../../src/index/build/incremental/semantic-cache.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';

const fixture = await createSemanticCacheFixture();
const lock = await acquireIndexLock({ repoCacheRoot: path.join(fixture.root, 'writer-cache'), requireSettlement: true });
assert.ok(lock);
const lease = createIndexCacheLease(lock, path.join(fixture.root, 'writer-cache'));
const counters = () => ({ sourceBytes: 0, semanticBytes: 0, otherBytes: 0, copiedBytes: 0,
  hashCallWallMs: 0, processCpuDuringHashCallsMicros: { user: 0, system: 0 } });

// Instrument actual descriptor/stream reads and hash calls only inside this isolated fixture.
// Timing is a receipt, never a throughput threshold or full-index qualification.
const measure = async operation => {
  const values = counters(), readFile = fs.readFile, open = fs.open, copyFile = fs.copyFile;
  const createReadStream = nativeFs.createReadStream, createHash = crypto.createHash;
  const category = filename => typeof filename === 'string' && filename.startsWith(fixture.repoRoot + path.sep)
    ? 'sourceBytes' : typeof filename === 'string' && filename.startsWith(path.join(fixture.bundleDir, 'semantic') + path.sep)
      ? 'semanticBytes' : 'otherBytes';
  fs.readFile = async (...args) => {
    const bytes = await readFile(...args);
    values[category(args[0])] += Buffer.byteLength(bytes);
    return bytes;
  };
  fs.open = async (...args) => {
    const handle = await open(...args), read = handle.read.bind(handle), bucket = category(args[0]);
    handle.read = async (...readArgs) => { const result = await read(...readArgs); values[bucket] += result.bytesRead; return result; };
    return handle;
  };
  fs.copyFile = async (...args) => { const size = (await fs.stat(args[0])).size; await copyFile(...args); values.copiedBytes += size; };
  nativeFs.createReadStream = (...args) => {
    const stream = createReadStream(...args), bucket = category(args[0]);
    stream.on('data', bytes => { values[bucket] += Buffer.byteLength(bytes); });
    return stream;
  };
  crypto.createHash = (...args) => {
    const hash = createHash(...args);
    for (const method of ['update', 'digest']) {
      const original = hash[method].bind(hash);
      hash[method] = (...methodArgs) => {
        const started = performance.now(), hashCpuStarted = process.cpuUsage();
        try { return original(...methodArgs); } finally {
          values.hashCallWallMs += performance.now() - started;
          const cpu = process.cpuUsage(hashCpuStarted);
          values.processCpuDuringHashCallsMicros.user += cpu.user;
          values.processCpuDuringHashCallsMicros.system += cpu.system;
        }
      };
    }
    return hash;
  };
  syncBuiltinESMExports();
  const started = performance.now(), cpuStarted = process.cpuUsage();
  let peakResidentBytes = process.memoryUsage().rss;
  const timer = setInterval(() => { peakResidentBytes = Math.max(peakResidentBytes, process.memoryUsage().rss); }, 1);
  try {
    const result = await operation();
    return { result, receipt: { ...values, wallMs: performance.now() - started,
      cpuMicros: process.cpuUsage(cpuStarted), peakResidentBytes: Math.max(peakResidentBytes, process.memoryUsage().rss) } };
  } finally {
    clearInterval(timer); fs.readFile = readFile; fs.open = open; fs.copyFile = copyFile;
    nativeFs.createReadStream = createReadStream; crypto.createHash = createHash; syncBuiltinESMExports();
  }
};

try {
  const cold = await measure(async () => [await fixture.createFile({ file: 'first.js', nodeCount: 96 }),
    await fixture.createFile({ file: 'second.js', text: 'g(1);', nodeCount: 96 })]);
  const files = cold.result;
  const records = { cold: cold.receipt };
  const replay = async (name, verified) => {
    const verification = verified ? createSemanticReplayVerificationContext({ bundleDir: fixture.bundleDir,
      maxBytes: 1024 * 1024, lease }) : null;
    const account = createSemanticDiskAccount(16 * 1024 * 1024);
    const buildRoot = path.join(fixture.root, name);
    const context = { repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot,
      dependencySignatures: fixture.dependencies, diskAccount: account, buildRoot,
      storage: { ...fixture.storage, generation: { baseBuildId: name, semanticRevision: 0 } }, replayVerification: verification };
    const state = { enabled: true, bundleDir: fixture.bundleDir, bundleFormat: 'json',
      manifest: structuredClone(fixture.manifest), readHashCache: new Map(), semanticReplayVerification: verification };
    const result = await measure(async () => {
      const entries = files.map(file => ({ rel: file.file, abs: path.join(fixture.repoRoot, file.file) }));
      const completed = await preloadFileCompletions({ entries, incrementalState: state, semanticContext: context });
      const reused = [];
      for (const file of files) {
        const outcome = await loadCachedBundleForFile({ repoRoot: fixture.repoRoot, runIo: fn => fn(), incrementalState: state,
          absPath: path.join(fixture.repoRoot, file.file), relKey: file.file,
          fileStat: { size: file.entry.size, mtimeMs: file.entry.mtimeMs }, semanticContext: context });
        if (outcome.cachedBundle) reused.push(outcome.semanticFactsRef);
      }
      return { completed: completed.size, reused };
    });
    records[name] = result.receipt;
    if (verification) {
      assert.ok(verification.metrics.verificationHits > 0);
      assert.ok(verification.metrics.peakMetadataBytes <= 1024 * 1024);
      assert.equal(verification.snapshotReceipts().length, result.result.reused.length);
      for (const receipt of verification.snapshotReceipts()) {
        assert.ok(receipt.verifiedBytes > 0);
        assert.ok(files.some(file => file.source.sourceUnitId === receipt.sourceUnitId && file.source.byteHash === receipt.sourceHash));
      }
      verification.clear();
    }
    return result;
  };
  const ordinary = await replay('warm-ordinary', false), verified = await replay('warm-verified', true);
  assert.equal(verified.result.reused.length, 2);
  assert.deepEqual(verified.result.reused.map(facts => facts.canonicalHash), ordinary.result.reused.map(facts => facts.canonicalHash));
  assert.ok(verified.receipt.semanticBytes < ordinary.receipt.semanticBytes, 'verified handoff must reduce measured cache reads on this unchanged fixture');
  assert.equal(verified.receipt.sourceBytes, ordinary.receipt.sourceBytes, 'the optimization retains current source reads');
  await fs.writeFile(path.join(fixture.repoRoot, files[0].file), 'h(2);');
  const changedOrdinary = await replay('changed-ordinary', false), changedVerified = await replay('changed-verified', true);
  assert.equal(changedVerified.result.completed, 1);
  assert.equal(changedVerified.result.reused.length, 1);
  assert.deepEqual(changedVerified.result.reused.map(facts => facts.sourceUnitId), changedOrdinary.result.reused.map(facts => facts.sourceUnitId));

  const file = files[1], input = { repoRoot: fixture.repoRoot, locator: file.entry.semanticCache,
    dependencySignatures: fixture.dependencies, sourceHash: file.source.byteHash,
    sourcePath: file.file, repositoryNamespace: fixture.repoRoot };
  const verification = createSemanticReplayVerificationContext({ bundleDir: fixture.bundleDir, maxBytes: 1024 * 1024, lease });
  const snapshot = await verification.verify(input);
  const storage = { ...fixture.storage, generation: { baseBuildId: 'token-checks', semanticRevision: 0 } };
  const options = { ...input, bundleDir: fixture.bundleDir, targetBuildRoot: path.join(fixture.root, 'token-checks'),
    storage, diskAccount: createSemanticDiskAccount(16 * 1024 * 1024), verificationToken: snapshot.token };
  assert.ok(snapshot.token);
  snapshot.factsRef.sourceHash = '0'.repeat(64);
  assert.equal((await relocateSemanticCacheEntry(options)).sourceHash, file.source.byteHash, 'caller mutations cannot alter token authority');
  await assert.rejects(relocateSemanticCacheEntry({ ...options, sourceHash: 'f'.repeat(64) }), { code: 'ERR_SEMANTIC_CACHE_MISMATCH' });
  await assert.rejects(relocateSemanticCacheEntry({ ...options, verificationToken: {}, sourcePath: 'renamed.js' }), { code: 'ERR_SEMANTIC_CACHE_MISMATCH' });
  const changedParser = { ...input, dependencySignatures: { ...fixture.dependencies, parse: 'new-parser' } };
  await assert.rejects(verification.verify(changedParser), { code: 'ERR_SEMANTIC_CACHE_MISMATCH' });
  const movedLane = await verification.verify({ ...input, dependencySignatures: { ...fixture.dependencies, lexical: 'new-lexical', semanticLayout: 'new-layout' } });
  assert.ok(movedLane, 'lexical/layout changes preserve source syntax eligibility under their separate lanes');
  const tiny = createSemanticReplayVerificationContext({ bundleDir: fixture.bundleDir, maxBytes: 1, lease });
  assert.equal((await tiny.verify(input)).token, null, 'capacity overflow performs verification without retaining metadata');
  assert.equal(tiny.metrics.metadataBytes, 0); tiny.clear();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(verification.verify({ ...input, signal: controller.signal }), { name: 'AbortError' });
  const cacheRoot = path.join(fixture.bundleDir, 'semantic', input.locator.cacheKey, 'parts');
  const piece = file.factsRef.partitions[0].members.semantic_records[0];
  await fs.appendFile(path.join(cacheRoot, piece.path), ' ');
  await assert.rejects(relocateSemanticCacheEntry(options), { code: 'ERR_SEMANTIC_INTEGRITY' }, 'changed inventory forces full verification and corruption rejection');
  verification.clear();
  await assert.rejects(verification.verify(input), /cleared/);
  lease.invalidate();
  assert.throws(() => createSemanticReplayVerificationContext({ bundleDir: fixture.bundleDir, maxBytes: 1024, lease }), { code: 'ERR_INDEX_CACHE_OWNERSHIP' });
  console.log(JSON.stringify({ fixture: 'verified-replay-handoff', receipts: records }));
} finally { lease.invalidate(); await lock.release(); await fixture.cleanup(); }
