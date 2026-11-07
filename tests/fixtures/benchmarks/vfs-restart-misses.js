import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { buildVfsColdStartPlan } from '../../../tools/bench/vfs/cold-start-sample.js';
import { resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

await requireBootstrap(); applyTestEnv();
const scenario = process.argv[2];
assert.ok(['compaction', 'mixed-regeneration'].includes(scenario));
const docs = scenario === 'compaction' ? 256 : 64, docBytes = 8191;
const { dir } = await prepareIsolatedTestCacheDir(`vfs-restart-${scenario}`);
const rootIdentity = await fs.lstat(dir, { bigint: true });
let failed = false, primary;
try {
  const run = async (mode, maxBytes) => {
    const child = await spawnSubprocess(process.execPath, ['tests/fixtures/benchmarks/vfs-budget-worker.js',
      JSON.stringify({ rootDir: dir, mode, maxBytes, docs, docBytes })], { timeoutMs: 30000, maxOutputBytes: 262144,
      outputMode: 'string', captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true, killTree: true });
    assert.equal(child.stderr, ''); assert.equal(child.outputCapture.stdout.truncated, false);
    const value = JSON.parse(child.stdout); assert.equal(value.pid, child.pid); return value;
  };
  const cold = await run('cold', docs * docBytes);
  assert.equal(cold.state, 'qualified-phase'); assert.equal(cold.counts.created, docs);
  if (scenario === 'mixed-regeneration') {
    const plan = await buildVfsColdStartPlan({ docs, docBytes, content: 'utf8' });
    for (const document of plan.documents.slice(0, docs / 2)) {
      const file = resolveVfsDiskPath({ baseDir: path.join(dir, 'vfs'), virtualPath: document.virtualPath });
      await fs.writeFile(file, Buffer.alloc(docBytes, 120));
    }
  }
  const warm = await run('warm', (scenario === 'compaction' ? docs / 2 : docs) * docBytes);
  assert.notEqual(cold.pid, warm.pid); assert.equal(warm.state, 'unqualified-phase');
  assert.deepEqual(warm.workload, cold.workload); assert.equal(warm.consumerParity.sha256, cold.consumerParity.sha256);
  assert.equal(warm.consumerParity.bytes, docs * docBytes);
  assert.equal(warm.finalCache.flushes - warm.initialCache.flushes, 1);
  assert.ok(warm.reasons.includes('persisted-admission-or-hit-coverage-incomplete'));
  if (scenario === 'compaction') {
    assert.equal(warm.initialCache.loadStatus, 'loaded-compacted'); assert.equal(warm.initialCache.loadedRows, docs);
    assert.equal(warm.initialCache.loadedEntries, docs / 2); assert.equal(warm.initialCache.evictions, docs / 2);
    assert.equal(warm.counts.persistedHits, 0); assert.equal(warm.counts.existingVerified, docs); assert.equal(warm.counts.created, 0);
    assert.ok(warm.finalCache.evictions >= docs); assert.ok(warm.initialCache.loadedInputBytes > 0);
  } else {
    assert.equal(warm.initialCache.loadedEntries, docs); assert.equal(warm.counts.persistedHits, docs / 2);
    assert.equal(warm.counts.regenerated, docs / 2); assert.equal(warm.counts.created, docs / 2);
    assert.equal(warm.counts.bytesWritten, docs / 2 * docBytes);
  }
  console.log(JSON.stringify({ schemaVersion: 1, scenario, cold, warm, claim: 'observed restart miss/compaction workload;not-qualified-all-hit-warm' }));
} catch (error) { failed = true; primary = error; }
try {
  if (failed) observeStorageResource(primary, { phase: 'vfs-restart-capsule-cleanup' }).requireSettled();
  const relative = path.relative(path.resolve('.tmp/dev/tests/cache'), dir), current = await fs.lstat(dir, { bigint: true });
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !current.isDirectory() || current.isSymbolicLink()
    || current.dev !== rootIdentity.dev || current.ino !== rootIdentity.ino) throw new Error('VFS restart fixture cleanup ownership changed.');
  await fs.rm(dir, { recursive: true, force: true });
} catch (cleanup) {
  if (failed) throw addStorageFailureContext(primary, { fixtureRoot: dir }, cleanup, { secondaryPresent: true });
  throw cleanup;
}
if (failed) throw primary;
