import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveSqliteBenchmarkPlan, createSqliteBenchmarkWorkload } from '../../../../tools/bench/sqlite/workload.js';
import { sqliteTrialArmOrder, summarizeSqliteSamples, runSqliteBenchmarkCampaign } from '../../../../tools/bench/sqlite/campaign.js';
import { readIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
if (selected === 'plan') {
  assert.equal(resolveSqliteBenchmarkPlan({}, 'build').fileCount, 20);
  assert.equal(resolveSqliteBenchmarkPlan({}, 'update').fileCount, 12);
  for (const profile of ['lexical', 'wide']) {
    const plan = resolveSqliteBenchmarkPlan({ profile }, 'update');
    assert.equal(plan.scope, 'lexical-candidate'); assert.equal(plan.trials, 6); assert.equal(plan.rounds, 3);
    assert.ok(plan.changedFiles > 1 && plan.addedFiles > 0 && plan.deletedFiles > 0 && plan.shrinkFiles > 0 && plan.growFiles > 0);
    assert.ok(plan.tokensPerChunk > 2); assert.equal(plan.lanes.dense, false);
  }
  const custom = resolveSqliteBenchmarkPlan({ profile: 'lexical', files: '24', chunks: '2', tokens: '2',
    'changed-files': '2', 'added-files': '1', 'deleted-files': '1', 'shrink-files': '1', 'grow-files': '1' }, 'update');
  assert.equal(custom.scope, 'custom', 'tiny overrides do not inherit representative-workload eligibility');
} else if (selected === 'rejection') {
  for (const args of [{ profile: 'unknown' }, { files: 'Infinity' }, { files: '4096', chunks: '512', tokens: '128' },
    { trials: '13' }, { tokens: '1' }, { rounds: '7' }, { 'changed-files': '1', 'shrink-files': '2' },
    { files: '3', 'changed-files': '3', 'deleted-files': '1' }, { profile: true }]) {
    assert.throws(() => resolveSqliteBenchmarkPlan(args, 'update'), TypeError);
  }
  assert.throws(() => resolveSqliteBenchmarkPlan({ rounds: '2' }, 'build'), /only to incremental/u);
} else if (selected === 'statistics-order') {
  assert.deepEqual(sqliteTrialArmOrder('compare', 0), ['baseline', 'current']);
  assert.deepEqual(sqliteTrialArmOrder('compare', 1), ['current', 'baseline']);
  assert.deepEqual(sqliteTrialArmOrder('current', 3), ['current']);
  assert.deepEqual(summarizeSqliteSamples([9, 1, 7, 3]), { count: 4, min: 1, median: 5, p95: 9, max: 9, total: 20 });
  assert.equal(summarizeSqliteSamples([3, 5, 1]).median, 3);
  assert.throws(() => summarizeSqliteSamples([]), TypeError);
  assert.throws(() => summarizeSqliteSamples([1, NaN]), TypeError);
} else if (selected === 'mutations') {
  const { dir } = await prepareIsolatedTestCacheDir('sqlite-campaign-mutations'), bundleDir = path.join(dir, 'bundles');
  await fs.mkdir(bundleDir);
  const plan = resolveSqliteBenchmarkPlan({ files: '24', chunks: '4', tokens: '12', trials: '2', rounds: '3',
    'changed-files': '4', 'added-files': '1', 'deleted-files': '1', 'shrink-files': '1', 'grow-files': '1' }, 'update');
  const workload = await createSqliteBenchmarkWorkload({ bundleDir, plan });
  const first = JSON.stringify(workload.initial.manifest);
  assert.equal(workload.initial.manifest.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
  assert.equal(workload.rounds.length, 3);
  for (const round of workload.rounds) {
    assert.equal(round.changedFiles, 5); assert.equal(round.deletedFiles, 1); assert.equal(round.insertedChunks, 20);
    assert.equal(Object.keys(round.manifest.files).length, 24);
    assert.deepEqual(new Set(round.mutations.map(row => row.kind)), new Set(['changed', 'shrunk', 'grown', 'added']));
    let rows = 0;
    for (const [file, entry] of Object.entries(round.manifest.files)) {
      const snapshot = await readIncrementalBundleSnapshot({ bundleDir, relKey: file, entry });
      assert.ok(snapshot); rows += snapshot.bundle.chunks.length;
      assert.equal(snapshot.bundle.chunks[0].tokens.length, 12);
      assert.ok(snapshot.bundle.chunks[0].tokens.filter(token => token === 'shared-term').length > 1);
    }
    assert.equal(rows, round.rows); assert.ok(round.deleted.every(file => !Object.hasOwn(round.manifest.files, file)));
  }
  assert.equal(JSON.stringify(workload.initial.manifest), first, 'later rounds never rewrite the starting source identity');
} else if (['build-trials', 'update-trials', 'failure-receipt'].includes(selected)) {
  const args = { files: '24', chunks: '2', trials: '2', mode: 'compare' };
  const operation = selected === 'build-trials' ? 'build' : 'update';
  if (operation === 'update') Object.assign(args, { rounds: '2', 'changed-files': '2', 'added-files': '1', 'deleted-files': '1', 'shrink-files': '1', 'grow-files': '1' });
  if (selected === 'failure-receipt') {
    let constructions = 0;
    const failure = new Error('original benchmark database failure');
    const Broken = function(...values) { if (++constructions === 1) throw failure; return new Database(...values); };
    const original = console.log, messages = [];
    console.log = (...values) => { messages.push(values.join(' ')); };
    try { await assert.rejects(runSqliteBenchmarkCampaign({ Database: Broken, args, operation }), error => error === failure); }
    finally { console.log = original; }
    const receiptPath = messages.find(message => message.startsWith('[bench] receipt '))?.slice('[bench] receipt '.length);
    assert.ok(receiptPath);
    const failed = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    assert.equal(failed.status, 'failed'); assert.equal(failed.failure.message, failure.message);
    assert.equal(failed.samples.length, 0); assert.equal(failed.paired.length, 0);
    assert.equal(failed.activeAttempt.phase, 'initial-build');
    assert.match(failed.activeAttempt.dbPath, /trial-1-baseline\.db$/u);
  } else {
    const report = await runSqliteBenchmarkCampaign({ Database, args, operation });
    assert.equal(report.status, 'completed');
    assert.equal(report.samples.length, operation === 'build' ? 4 : 8);
    assert.deepEqual(report.samples.filter(row => row.round === (operation === 'build' ? 0 : 1)).map(row => row.label),
      ['baseline', 'current', 'current', 'baseline']);
    assert.ok(report.samples.every(row => row.observation.chunks > 0 && row.stats.tables.chunks.rows > 0));
    assert.equal(report.paired.length, operation === 'build' ? 2 : 4);
    const saved = JSON.parse(await fs.readFile(report.receiptPath, 'utf8'));
    assert.equal(saved.rawSamplesSha256, report.rawSamplesSha256);
    assert.equal(saved.comparisonEligibility.repeatedIndependentTrials, false);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(path.dirname(report.receiptPath), 'checkpoint.json'), 'utf8')).samples, report.samples);
  }
} else assert.fail(`Unknown SQLite campaign control: ${selected}`);
console.log(`SQLite campaign ${selected} control`);
