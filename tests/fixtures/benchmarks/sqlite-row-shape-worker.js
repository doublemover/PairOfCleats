import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { createSqliteBenchWorkspace } from '../../../tools/bench/sqlite/shared.js';
import { createSqliteBenchmarkWorkload } from '../../../tools/bench/sqlite/workload.js';
import { runSqliteBenchmarkArm } from '../../../tools/bench/sqlite/campaign-arm.js';
import { sqliteTrialArmOrder } from '../../../tools/bench/sqlite/campaign.js';
import { sqliteRowQualificationPlan, assertSqliteRowQualificationWork } from '../../../tools/bench/sqlite/qualification-plan.js';
import { resolveDevelopmentArtifactPath } from '../../../tools/shared/dev-artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createSqliteBenchmarkPhaseObserver } from '../../../tools/bench/sqlite/phase-observer.js';

await requireBootstrap(); applyTestEnv();
const request = JSON.parse(process.argv[2]), root = path.resolve(request.root);
const base = resolveDevelopmentArtifactPath(process.cwd(), 'bench-cache', 'sqlite-row-shapes');
assert.equal(path.dirname(root), base, 'qualification reads only its explicit task-owned source capture');
const marker = JSON.parse((await readVerifiedContainedFile(root, path.join(root, 'artifact-benchmark-owner.json'), { maxBytes: 8192 })).buffer);
assert.equal(marker.runIdentity, request.runIdentity); assert.equal(marker.workRoot, path.join(root, 'work'));
const bundleDir = path.join(marker.workRoot, 'bundles'), plan = sqliteRowQualificationPlan(request.shape);
if (request.command === 'prepare') {
  const workload = await createSqliteBenchmarkWorkload({ bundleDir, plan, sqliteMode: 'code' });
  assertSqliteRowQualificationWork(workload, request.shape);
  const file = path.join(root, `${request.shape}-capture.json`);
  await atomicWriteJson(file, { schemaVersion: 1, shape: request.shape, plan, workload, bundleDir }, { createOnly: true });
  const read = await readVerifiedContainedFile(root, file, { maxBytes: 8 * 1024 * 1024 });
  console.log(JSON.stringify({ command: 'prepare', descriptor: { file, bytes: read.buffer.byteLength, sha256: read.hash },
    initialManifestSha256: workload.initial.manifestSha256, rows: workload.initial.rows }));
} else {
  const descriptor = request.capture;
  assert.equal(path.dirname(descriptor.file), root);
  const read = await readVerifiedContainedFile(root, descriptor.file, { maxBytes: 8 * 1024 * 1024,
    expectedBytes: descriptor.bytes, expectedHash: descriptor.sha256 });
  const input = JSON.parse(read.buffer); assert.equal(input.schemaVersion, 1); assert.equal(input.shape, request.shape);
  assert.equal(input.bundleDir, bundleDir); assert.deepEqual(input.plan, plan); assertSqliteRowQualificationWork(input.workload, request.shape);
  const { default: NativeDatabase } = await import('better-sqlite3');
  const phaseObserver = createSqliteBenchmarkPhaseObserver({ emit: record => writeSync(2, JSON.stringify(record) + '\n') });
  const Database = phaseObserver.wrapDatabase(NativeDatabase);
  const seedPath = path.join(marker.workRoot, `seed-${input.workload.initial.manifestSha256}.db`);
  if (request.command === 'seed') {
    await assert.rejects(fs.stat(seedPath), { code: 'ENOENT' });
    const result = await runSqliteBenchmarkArm({ Database, operation: 'build', label: 'current', trial: 1, order: ['current'],
      bundleDir, workload: input.workload, outPath: seedPath, phaseObserver,
      onProgress: progress => atomicWriteJson(path.join(root, `seed-${request.shape}-checkpoint.json`), progress) });
    console.log(JSON.stringify({ command: 'seed', seedPath, result, phaseDiagnostics: phaseObserver.snapshot() }));
  } else {
    assert.equal(request.command, 'arm'); assert.ok(['build', 'update'].includes(request.operation));
    assert.ok(Number.isSafeInteger(request.trial) && request.trial >= 1 && request.trial <= 6);
    const workspace = await createSqliteBenchWorkspace({ name: 'sqlite-row-shape-arm' });
    const report = { schemaVersion: 1, shape: request.shape, operation: request.operation, trial: request.trial,
      label: request.label, expectedTrialCount: 6, completedTrialCount: 0, status: 'running' };
    let failed = false, primary;
    try {
      const result = await runSqliteBenchmarkArm({ Database, operation: request.operation, label: request.label,
        trial: request.trial, order: sqliteTrialArmOrder('compare', request.trial - 1), bundleDir, workload: input.workload,
        outPath: path.join(workspace.workRoot, 'arm.db'), seedPath: request.operation === 'update' ? seedPath : null, phaseObserver,
        onProgress: progress => atomicWriteJson(path.join(workspace.tempRoot, 'checkpoint.json'), { ...report, ...progress }) });
      assert.equal(result.samples.length, request.operation === 'build' ? 1 : 3);
      for (const sample of result.samples) {
        assert.equal(sample.observation.chunks, plan.fileCount * 512);
        assert.equal(sample.observation.inputAdmission.manifestSha256, sample.manifestSha256);
        assert.ok(sample.stats.tables.chunks.rows > 0); assert.ok(sample.stats.runtimeTelemetry.plan.inputBytes > 0);
        if (request.operation === 'update') {
          assert.equal(sample.mutations.insertedChunks, request.shape === 'large-high' ? 53248 : 2048);
          assert.equal(sample.stats.runtimeTelemetry.plan.rowCount, sample.mutations.insertedChunks);
          assert.equal(sample.stats.transactionPhases.deletes, true); assert.equal(sample.stats.transactionPhases.inserts, true);
        } else assert.equal(sample.stats.runtimeTelemetry.plan.rowCount, plan.fileCount * 512);
      }
      Object.assign(report, result, { status: 'completed', completedTrialCount: 1 });
      await atomicWriteJson(path.join(workspace.tempRoot, 'final.json'), report, { createOnly: true });
      report.generatedWork = await workspace.workOwner.reclaim();
      await atomicWriteJson(path.join(workspace.tempRoot, 'cleanup.json'), report.generatedWork, { createOnly: true });
    } catch (error) { failed = true; primary = error; report.status = 'failed'; report.retainedWorkRoot = workspace.workRoot; }
    if (failed) {
      try { await atomicWriteJson(path.join(workspace.tempRoot, 'failure.json'), report, { createOnly: true }); }
      catch (publication) { throw addStorageFailureContext(primary, {}, publication, { secondaryPresent: true }); }
      throw primary;
    }
    console.log(JSON.stringify({ ...report, receiptRoot: workspace.tempRoot, phaseDiagnostics: phaseObserver.snapshot() }));
  }
}
