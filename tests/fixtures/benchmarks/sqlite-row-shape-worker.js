import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { createSqliteBenchmarkWorkload } from '../../../tools/bench/sqlite/workload.js';
import { copySqliteBenchSeed, runSqliteBenchmarkMutation } from '../../../tools/bench/sqlite/campaign-arm.js';
import { sqliteTrialArmOrder } from '../../../tools/bench/sqlite/campaign.js';
import { sqliteRowQualificationPlan, assertSqliteRowQualificationWork } from '../../../tools/bench/sqlite/qualification-plan.js';
import { resolveDevelopmentArtifactPath } from '../../../tools/shared/dev-artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createSqliteBenchmarkPhaseObserver } from '../../../tools/bench/sqlite/phase-observer.js';
import { createSqliteBenchInputCache, prepareSqliteBenchValidation, validateSqliteBenchDatabase } from '../../../tools/bench/sqlite/validate.js';
import { performance } from 'node:perf_hooks';

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
  assert.ok(['seed', 'arm'].includes(request.command));
  const seed = request.command === 'seed';
  let receiptRoot = root, outPath = seedPath;
  if (!seed) {
    assert.equal(path.dirname(request.armRoot), base);
    const arm = JSON.parse((await readVerifiedContainedFile(request.armRoot,
      path.join(request.armRoot, 'artifact-benchmark-owner.json'), { maxBytes: 8192 })).buffer);
    assert.equal(arm.runIdentity, request.armIdentity); assert.equal(arm.workRoot, path.join(request.armRoot, 'work'));
    receiptRoot = request.armRoot; outPath = path.join(arm.workRoot, 'arm.db');
  }
  if (!seed) {
    assert.ok(Number.isSafeInteger(request.trial) && request.trial >= 1 && request.trial <= 6);
    assert.ok(['baseline', 'current'].includes(request.label));
  }
  const operation = seed ? 'build' : request.operation, round = seed ? 0 : request.round;
  assert.ok(['build', 'update'].includes(operation));
  assert.ok(Number.isSafeInteger(round) && (operation === 'build' ? round === 0 : round >= 0 && round <= 3));
  assert.ok(seed ? ['execute', 'validate'].includes(request.phase)
    : operation === 'build' ? ['execute', 'validate'].includes(request.phase)
      : round === 0 ? request.phase === 'setup' : request.phase === 'round');
  const step = round === 0 ? input.workload.initial : input.workload.rounds[round - 1];
  const inputCache = createSqliteBenchInputCache();
  const admission = await phaseObserver.run('source-admission', () => prepareSqliteBenchValidation({ bundleDir,
    manifest: step.manifest, cache: inputCache }));
  const report = { command: request.command, phase: request.phase, shape: request.shape, operation, round,
    trial: seed ? 1 : request.trial, label: seed ? 'current' : request.label,
    status: 'running', manifestSha256: step.manifestSha256 };
  const validate = async name => {
    const at = performance.now();
    report.observation = await phaseObserver.run(name, () => validateSqliteBenchDatabase({ Database, dbPath: outPath,
      bundleDir, manifest: step.manifest, mode: 'code', expectedRows: step.rows, admission }));
    report.validationMs = performance.now() - at;
  };
  const checkpoint = path.join(receiptRoot, request.command + '-round-' + round + '-' + request.phase + '.json');
  try {
    if (request.phase === 'setup') {
      await assert.rejects(fs.stat(outPath), { code: 'ENOENT' });
      const at = performance.now();
      await phaseObserver.run('initial-native-backup', () => copySqliteBenchSeed(Database, seedPath, outPath));
      report.buildMs = performance.now() - at;
      await validate('initial-validation'); report.status = 'validated';
    } else if (request.phase === 'validate') {
      await validate('database-validation'); report.status = 'validated';
    } else {
      if (operation === 'build') await assert.rejects(fs.stat(outPath), { code: 'ENOENT' });
      report.sample = await runSqliteBenchmarkMutation({ Database, operation, label: report.label, trial: report.trial,
        order: seed ? ['current'] : sqliteTrialArmOrder('compare', request.trial - 1), round, workload: input.workload,
        bundleDir, outPath, initial: admission, phaseObserver,
        onProgress: activeAttempt => atomicWriteJson(checkpoint, { ...report, activeAttempt }) });
      if (operation === 'update') {
        assert.equal(report.sample.mutations.insertedChunks, request.shape === 'large-high' ? 53248 : 2048);
        assert.equal(report.sample.stats.runtimeTelemetry.plan.rowCount, report.sample.mutations.insertedChunks);
        assert.equal(report.sample.stats.transactionPhases.deletes, true);
        assert.equal(report.sample.stats.transactionPhases.inserts, true);
      } else assert.equal(report.sample.stats.runtimeTelemetry.plan.rowCount, plan.fileCount * 512);
      assert.ok(report.sample.stats.runtimeTelemetry.plan.inputBytes > 0);
      if (request.phase === 'round') { await validate('database-validation'); report.status = 'validated'; }
      else report.status = 'operation-completed-unvalidated';
    }
    await atomicWriteJson(checkpoint, report);
  } catch (error) {
    report.status = 'failed'; report.retainedWorkRoot = path.dirname(outPath);
    try { await atomicWriteJson(checkpoint, report); }
    catch (publication) { throw addStorageFailureContext(error, {}, publication, { secondaryPresent: true }); }
    throw error;
  }
  console.log(JSON.stringify({ ...report, phaseDiagnostics: phaseObserver.snapshot() }));
}
