import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createSqliteBenchmarkPhaseObserver } from '../../../../tools/bench/sqlite/phase-observer.js';
import { admitSqliteBenchmarkPhaseDiagnostics } from '../../../../tools/bench/sqlite/phase-diagnostics.js';
import { createSqliteBenchBundleFixture } from '../../../../tools/bench/sqlite/shared.js';
import { runSqliteBenchmarkArm } from '../../../../tools/bench/sqlite/campaign-arm.js';
import { spawnSubprocess } from '../../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-phase-observer');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
try {
  const records = [], observer = createSqliteBenchmarkPhaseObserver({ emit: row => records.push(row) });
  const bundleDir = path.join(dir, 'bundles'); await fs.mkdir(bundleDir);
  const { manifest } = await createSqliteBenchBundleFixture({ bundleDir, fileCount: 2, chunksPerFile: 2 });
  const result = await runSqliteBenchmarkArm({ Database: observer.wrapDatabase(Database), operation: 'build',
    label: 'current', trial: 1, order: ['current'], bundleDir, outPath: path.join(dir, 'arm.db'), phaseObserver: observer,
    workload: { initial: { manifest, rows: 4, manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex') }, rounds: [] } });
  assert.equal(result.samples.length, 1); assert.equal(result.samples[0].observation.chunks, 4);
  assert.deepEqual(observer.snapshot().active, []); assert.equal(observer.snapshot().droppedRecords, 0);
  assert.equal(admitSqliteBenchmarkPhaseDiagnostics({ stderr: records.map(row => JSON.stringify(row)).join('\n') + '\n',
    report: { phaseDiagnostics: observer.snapshot() }, request: { command: 'seed' } }).state, 'accepted');
  const find = (phase, state) => records.findIndex(row => row.phase === phase && row.state === state);
  for (const phase of ['source-admission', 'bundle-build', 'native-open', 'transaction-begin', 'chunk-indexes',
    'filter-facts-rebuild', 'filter-facts-seal', 'transaction-commit', 'fts-optimize', 'wal-checkpoint', 'native-close', 'database-validation']) {
    assert.ok(find(phase, 'start') >= 0, phase);
    assert.ok(find(phase, 'end') > find(phase, 'start'), phase);
  }
  assert.ok(find('native-close', 'end') < find('bundle-build', 'end'));
  assert.ok(find('bundle-build', 'end') < find('database-validation', 'start'));
  assert.ok(records.some(row => row.state === 'progress' && row.completedFiles === 2 && row.totalFiles === 2));
  for (const value of [null, false, 0, '', Object.freeze(new Error('exact original phase failure'))]) {
    const rows = [], controlled = createSqliteBenchmarkPhaseObserver({ emit: row => rows.push(row) });
    await assert.rejects(controlled.run('original-failure', () => { throw value; }), error => error === value);
    assert.equal(rows.at(-1).state, 'failed'); assert.deepEqual(controlled.snapshot().active, []);
  }
  const primary = Object.freeze(new Error('original work rejection')), secondary = Object.freeze(new Error('original diagnostic rejection'));
  const failedEmitter = createSqliteBenchmarkPhaseObserver({ emit: row => { if (row.state === 'failed') throw secondary; } });
  await assert.rejects(failedEmitter.run('two-failures', () => { throw primary; }), error => error.cause === primary && error.errors.includes(secondary));
  const limited = [], capped = createSqliteBenchmarkPhaseObserver({ emit: row => limited.push(row) });
  for (let n = 0; n < 150; n++) await capped.run('finite-work', () => n);
  assert.equal(limited.length, 256); assert.equal(capped.snapshot().droppedRecords, 45);
  assert.equal(limited.at(-1).state, 'diagnostics-truncated');
  assert.deepEqual(capped.snapshot().active, []);
  const coarseRows = [], coarse = createSqliteBenchmarkPhaseObserver({ emit: row => coarseRows.push(row) });
  await coarse.run('bundle-build', () => {
    for (let n = 0; n < 328 * 3; n++) coarse.progress(`[sqlite] bundles ${n % 328}/328`);
  });
  assert.equal(coarse.snapshot().progressRecords, 24); assert.equal(coarse.snapshot().progressSuppressed, 328 * 3 - 24);
  assert.equal(coarse.snapshot().droppedRecords, 0);
  assert.equal(coarseRows.at(-1).state, 'end', 'large three-round progress cannot crowd out terminal evidence');

  const controller = new AbortController(), cause = new Error('observed original synchronous hold');
  let captured = '';
  await assert.rejects(spawnSubprocess(process.execPath, [path.resolve('tests/fixtures/benchmarks/sqlite-phase-observer-hold.js')], {
    cwd: process.cwd(), signal: controller.signal, timeoutMs: 5000, maxOutputBytes: 65536,
    onStderr(text) { captured += text; if (captured.includes('"phase":"transaction-commit"')) controller.abort(cause); }
  }), error => {
    const rows = captured.trim().split('\n').map(row => JSON.parse(row));
    assert.ok(rows.some(row => row.phase === 'transaction-commit' && row.state === 'start'));
    assert.equal(rows.some(row => row.phase === 'transaction-commit' && row.state === 'end'), false);
    assert.equal(error.result.termination.closeObserved, true);
    return error.name === 'AbortError' || error.code === 'ABORT_ERR';
  });
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Private bounded synchronous phase records follow actual SQLite work/close boundaries and survive a controlled forced child stop.');
