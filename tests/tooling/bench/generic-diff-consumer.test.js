import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runBenchRunner } from '../../../tools/bench/bench-runner.js';
import { compareGenericBenchmarkReports } from '../../../tools/bench/generic-diff.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('generic-diff-consumer');
const script = 'tools/bench/micro/hash.js', hash = 'sha256:' + 'a'.repeat(64);
const produce = async ms => (await runBenchRunner({ argv: { suite: 'fixture', quiet: true },
  resolveSuite: () => [{ id: 'small', script, args: ['--size', '100'] }, { id: 'large', script, args: ['--size', '1000'] }],
  run: ({ script, args }) => ({ script, absScript: path.resolve(script), exitCode: 0, timedOut: false, signal: null,
    durationMs: ms, stdout: '', stderr: '', parsed: { current: { metrics: { ms } } },
    json: { benchmarkObservation: { version: 1, scope: 'fixture',
      workload: { id: args[1], producerVersion: 'independent-fixture-v1', units: Number(args[1]), dataIdentity: hash, configurationIdentity: hash },
      correctness: { state: 'passed', checks: ['independent-result-parity'] }, metrics: { durationMs: ms }, knobs: {} } } }) })).report;
const before = await produce(100), after = await produce(50);
const good = compareGenericBenchmarkReports(before, after);
assert.equal(good.comparableCases, 2); assert.equal(good.diffs.length, 2);
assert.deepEqual(good.diffs.map(row => row.id), ['large', 'small']);
assert.ok(good.diffs.every(row => row.deltaMs === -50 && row.deltaPct === -50 && row.arm === 'current'));
for (const defect of ['args', 'units', 'corpus', 'configuration', 'missing-observation', 'failed', 'skipped', 'timeout', 'missing-current', 'null-duration', 'legacy']) {
  const changed = structuredClone(after), row = changed.results[0];
  if (defect === 'args') row.args = ['--size', '1'];
  if (defect === 'units') row.json.benchmarkObservation.workload.units = 1;
  if (defect === 'corpus') row.json.benchmarkObservation.workload.dataIdentity = 'sha256:' + 'b'.repeat(64);
  if (defect === 'configuration') row.json.benchmarkObservation.workload.configurationIdentity = 'sha256:' + 'b'.repeat(64);
  if (defect === 'missing-observation') delete row.json.benchmarkObservation;
  if (defect === 'failed') { row.ok = false; row.status = 'error'; row.exitCode = 1; }
  if (defect === 'skipped') { row.ok = false; row.skipped = true; row.status = 'skipped'; }
  if (defect === 'timeout') row.timedOut = true;
  if (defect === 'missing-current') { row.parsed.baseline = row.parsed.current; delete row.parsed.current; }
  if (defect === 'null-duration') row.parsed.current.metrics.ms = null;
  if (defect === 'legacy') { delete row.id; delete changed.workload; }
  const result = compareGenericBenchmarkReports(before, changed);
  const invalid = result.diffs.find(value => value.id === 'small' || defect === 'legacy' && value.reasons.includes('declared-case-identity-missing'));
  assert.equal(invalid.state, 'incomparable', defect); assert.equal(invalid.deltaPct, null, defect); assert.equal(invalid.deltaMs, null, defect);
}
const changedSource = structuredClone(after); changedSource.runner.node = 'another-supported-source-revision';
changedSource.sourceValidation = [{ state: 'unchanged', sha256: 'b'.repeat(64) }];
assert.equal(compareGenericBenchmarkReports(before, changedSource).comparableCases, 2, 'source changes are the intended comparison axis');
const duplicate = structuredClone(after); duplicate.results.push(structuredClone(duplicate.results[0]));
const duplicated = compareGenericBenchmarkReports(before, duplicate);
assert.equal(duplicated.diffs.length, 3); assert.ok(duplicated.diffs.filter(row => row.id === 'small').every(row => row.deltaPct === null));
for (const [name, value] of [['before', before], ['after', after]]) await fs.writeFile(path.join(dir, name + '.json'), JSON.stringify(value));
const cli = runNode(['tools/bench/bench-diff.js', '--before', path.join(dir, 'before.json'), '--after', path.join(dir, 'after.json'), '--json'],
  'generic diff actual CLI', process.cwd(), process.env, { stdio: 'pipe', allowFailure: true });
assert.equal(cli.status, 0, cli.stderr); assert.deepEqual(JSON.parse(cli.stdout), good);
console.log('Actual runner -> generic diff -> CLI retains declared cases and rejects changed/missing/failed current-arm work before deltas.');
