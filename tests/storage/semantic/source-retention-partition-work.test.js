import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { semanticBatch, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const match = /^(shared|distinct)-(1|4|16)$/u.exec(selected || '');
assert.ok(match, 'select one bounded real-partition work case');
const shared = match[1] === 'shared', count = Number(match[2]), bytesPerSource = 1024 * 1024;
const { dir } = await prepareIsolatedTestCacheDir('source-retention-partition-work-' + selected);
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const inputs = Array.from({ length: shared ? 1 : count }, (_, index) => {
  const bytes = Buffer.alloc(bytesPerSource, 97); bytes.write(String(index));
  return { bytes, snapshot: createSemanticSourceSnapshot({ bytes, repositoryNamespace: 'fixture:partition-work',
    path: `source-${index}.js`, language: 'javascript' }) };
});
const original = { from: Buffer.from, open: fs.open };
const hashPrototype = Object.getPrototypeOf(createHash('sha256')), originalHashUpdate = hashPrototype.update;
const samples = [];
try {
  for (const arm of ['capability', 'raw-buffer-control']) {
    const stagingRoot = path.join(dir, arm), sourceRoot = path.join(stagingRoot, 'semantic-sources');
    await fs.mkdir(sourceRoot, { recursive: true });
    const account = createSemanticDiskAccount(64 * 1024 * 1024), metrics = {}, sources = new Set();
    for (const { bytes, snapshot } of inputs) {
      const filename = path.join(sourceRoot, snapshot.manifest.byteHash + '.utf8');
      await fs.writeFile(filename, bytes); account.reserve(bytes.length); sources.add(filename);
    }
    const sinks = [];
    for (let index = 0; index < count; index++) {
      const { bytes, snapshot } = inputs[shared ? 0 : index];
      const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId,
        parser: { family: 'fixture', version: '1', options: { partition: index } },
        extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: { structure: 'complete' } });
      const sink = await createSemanticPartitionSink({ stagingRoot, source: snapshot.manifest, sourceBytes: bytes,
        sourceCapability: arm === 'capability' ? snapshot.sourceCapability : null, partitionId,
        producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), diskAccount: account, metrics });
      await sink.appendBatch(semanticBatch(partitionId, [semanticNode(0, snapshot.manifest.textLength)]));
      sinks.push(sink);
    }
    let readBytes = 0, sourceOpens = 0, sourceCopies = 0, sourceCopyBytes = 0, sourceHashes = 0, sourceHashBytes = 0;
    Buffer.from = function(value, ...args) {
      const length = typeof value === 'string' ? Buffer.byteLength(value, args[0]) : value?.byteLength;
      if (length === bytesPerSource) { sourceCopies++; sourceCopyBytes += length; }
      return original.from.call(this, value, ...args);
    };
    hashPrototype.update = function(value, ...args) {
      const length = typeof value === 'string' ? Buffer.byteLength(value, args[0]) : value?.byteLength;
      if (length === bytesPerSource) { sourceHashes++; sourceHashBytes += length; }
      return originalHashUpdate.call(this, value, ...args);
    };
    fs.open = async (filename, ...args) => {
      const handle = await original.open(filename, ...args);
      if (sources.has(path.resolve(String(filename)))) {
        sourceOpens++;
        const read = handle.read;
        handle.read = async function(...input) {
          const result = await read.apply(this, input); readBytes += result.bytesRead; return result;
        };
      }
      return handle;
    };
    const started = performance.now();
    let descriptors;
    try { descriptors = await Promise.all(sinks.map(sink => sink.finalizeSource())); }
    finally { Buffer.from = original.from; hashPrototype.update = originalHashUpdate; fs.open = original.open; }
    const distinctSources = shared ? 1 : count;
    const sample = { case: selected, arm, partitions: count, distinctSources, bytesPerSource,
      canonicalPartitionHashes: descriptors.map(value => value.canonicalHash),
      retentionReadBytes: readBytes, retentionSourceOpens: sourceOpens,
      retentionCopies: sourceCopies, retentionCopyBytes: sourceCopyBytes,
      retentionHashes: sourceHashes, retentionHashBytes: sourceHashBytes,
      verifications: metrics.semanticRetentionVerifications, receiptHits: metrics.semanticSourceReceiptHits || 0,
      elapsedMs: performance.now() - started, accountUsed: account.used,
      sourcePreparation: 'snapshots and preexisting ordinary source files prepared before measured finalization' };
    console.log(JSON.stringify({ sourceRetentionSample: sample }));
    assert.equal(descriptors.length, count);
    assert.equal(new Set(descriptors.map(value => value.partitionId)).size, count);
    assert.equal(readBytes, distinctSources * bytesPerSource, 'real partitions share one complete durable verification per source');
    assert.equal(sourceOpens, distinctSources, 'real source descriptors confirm complete verification counts independently of metrics');
    assert.equal(metrics.semanticRetentionBytesRead, readBytes);
    assert.equal(metrics.semanticRetentionVerifications, distinctSources);
    assert.equal(metrics.semanticSourceReceiptHits || 0, count - distinctSources);
    assert.equal(sourceCopies, arm === 'capability' ? distinctSources : count);
    assert.equal(sourceHashes, arm === 'capability' ? 0 : count, 'raw mutable inputs retain their required independent hash');
    assert.equal(metrics.semanticSourceSnapshotBytes || 0, arm === 'capability' ? 0 : count * bytesPerSource);
    samples.push(sample);
  }
  assert.deepEqual(samples[0].canonicalPartitionHashes, samples[1].canonicalPartitionHashes,
    'private capabilities preserve the actual canonical content of every raw-buffer control partition');
  console.log(JSON.stringify({ samples, scope: 'real partition finalization source work; elapsed samples are descriptive, not a latency threshold or isolated speedup claim' }));
} finally {
  Buffer.from = original.from; hashPrototype.update = originalHashUpdate; fs.open = original.open;
  const relative = path.relative(process.cwd(), dir);
  assert.ok(relative.startsWith(`.tmp${path.sep}`) && !relative.startsWith('..'));
  await fs.rm(dir, { recursive: true, force: true });
}
