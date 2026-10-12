import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { createSemanticTaskId } from '../../../src/index/semantic/identity.js';
import { openSemanticFrontier } from '../../../src/index/semantic/frontier.js';
import { preloadFileCompletions } from '../../../src/index/build/incremental/file-completion.js';
import { loadCachedBundleForFile } from '../../../src/index/build/file-processor/incremental.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';
import { persistSemanticCacheEntry } from '../../../src/index/build/incremental/semantic-cache.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';

const fixture = await createSemanticCacheFixture();
const workers = [];
let control;
try {
  const files = [await fixture.createFile({ zeroChunks: true }), await fixture.createFile({ file: 'other.js' })];
  const bundleDir = path.join(fixture.root, 'interrupted-bundles');
  await fs.mkdir(bundleDir);
  const filename = path.join(fixture.root, 'interrupted-control.sqlite');
  const start = new Int32Array(new SharedArrayBuffer(4));
  const tasks = files.map((file, index) => {
    const inputHashes = [file.partition.canonicalHash], policyHash = 'b'.repeat(64), targetSetHash = String(index + 1).repeat(64);
    return { schemaVersion: 1, taskId: createSemanticTaskId({ kind: 'bind', inputHashes, policyHash, targetSetHash }),
      kind: 'bind', baseBuildId: fixture.generation.baseBuildId, sourceUnits: [file.source.sourceUnitId], inputHashes,
      policyHash, targetSetHash, targetsRef: 'immutable:targets', dependencies: [], priority: 1,
      reason: 'interrupted_fixture', coverageToProduce: ['bindings'] };
  });
  await Promise.all(files.map((file, index) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../helpers/semantic-interrupted-worker.js', import.meta.url), {
      workerData: { filename, start, task: tasks[index], bundleInput: { enabled: true, bundleDir, relKey: file.file,
        fileStat: { mtimeMs: file.entry.mtimeMs, size: file.bytes.length }, fileHash: file.entry.hash,
        fileChunks: file.chunks, fileRelations: null, dependencySignatures: fixture.dependencySignatures,
        semanticFactsRef: file.factsRef, semanticContext: { buildRoot: fixture.buildRoot, dependencySignatures: fixture.dependencies } } }
    });
    workers.push(worker);
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error('Worker exited before completion: ' + code)); });
  })));
  await Promise.all(workers.map(worker => worker.terminate()));
  control = openSemanticFrontier({ Database, filename });
  assert.deepEqual(control.leaseReady({ baseBuildId: fixture.generation.baseBuildId, owner: 'restart', now: 199 }), []);
  const leases = control.leaseReady({ baseBuildId: fixture.generation.baseBuildId, owner: 'restart', now: 201 });
  assert.equal(leases.length, 2);
  assert.ok(leases.every(lease => lease.attempt === 2));
  for (const task of tasks) assert.equal(control.getOutput(task.taskId), null, 'file completion is not publication');

  const reopened = await reopenSemanticDiskAccount({ roots: [bundleDir], limit: 16 * 1024 * 1024 });
  const context = { repoRoot: fixture.repoRoot, repositoryNamespace: fixture.repoRoot,
    dependencySignatures: fixture.dependencies, diskAccount: reopened.account,
    buildRoot: path.join(fixture.root, 'resumed'), storage: { ...fixture.storage,
      generation: { baseBuildId: 'resumed', semanticRevision: 0 } } };
  const state = { enabled: true, bundleDir, bundleFormat: 'json', readHashCache: new Map(),
    manifest: { ...fixture.manifest, files: {} } };
  const entries = files.toReversed().map(file => ({ rel: file.file, abs: path.join(fixture.repoRoot, file.file) }));
  const pending = path.join(fixture.repoRoot, 'unfinished.js');
  await fs.writeFile(pending, 'unfinished();');
  entries.unshift({ rel: 'unfinished.js', abs: pending });
  const ready = await preloadFileCompletions({ entries, incrementalState: state, semanticContext: context });
  assert.equal(ready.size, 2); assert.ok(!ready.has(pending));
  const applied = [];
  const appender = buildOrderedAppender(async result => { applied.push(result.file); }, {}, { expectedIndices: [7, 900000000] });
  const loaded = await Promise.all(files.map(async (file, index) => {
    const cached = await loadCachedBundleForFile({ repoRoot: fixture.repoRoot, runIo: fn => fn(), incrementalState: state,
      absPath: path.join(fixture.repoRoot, file.file), relKey: file.file,
      fileStat: { mtimeMs: file.entry.mtimeMs, size: file.bytes.length }, semanticContext: context });
    assert.ok(cached.semanticFactsRef);
    assert.equal(cached.semanticFactsRef.canonicalHash, file.factsRef.canonicalHash);
    return { file: file.file, index: index ? 900000000 : 7 };
  }));
  await Promise.all(loaded.toReversed().map(result => appender.enqueue(result.index, result, { workerId: 'new-owner' })));
  await appender.drain(); appender.assertCompletion();
  assert.deepEqual(applied, files.map(file => file.file), 'changed owners/discovery order replay through the existing sparse commit cursor');

  const shared = createSemanticDiskAccount(16 * 1024 * 1024), raced = path.join(fixture.root, 'raced-cache');
  const options = { bundleDir: raced, factsRef: files[0].factsRef, buildRoot: fixture.buildRoot,
    dependencySignatures: fixture.dependencies, diskAccount: shared };
  const winners = await Promise.all([persistSemanticCacheEntry(options), persistSemanticCacheEntry(options)]);
  assert.deepEqual(winners[0], winners[1]);
  assert.equal(shared.used, (await reopenSemanticDiskAccount({ roots: [raced], limit: shared.limit })).retainedBytes);
  console.log('terminated workers recover durable files and expired leases; equivalent cache publication converges');
} finally {
  await Promise.all(workers.map(worker => worker.terminate()));
  control?.close(); await fixture.cleanup();
}
