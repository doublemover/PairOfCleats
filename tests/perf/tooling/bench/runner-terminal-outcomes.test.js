import assert from 'node:assert/strict';
import { runBenchRunner } from '../../../../tools/bench/bench-runner.js';
import { classifyBenchOutcome, readBenchSkipReceipt } from '../../../../tools/bench/runner-outcome.js';
import { BENCH_TERMINAL_RECEIPT_VERSION } from '../../../../tools/bench/runner-contract.js';
import { createBenchRunnerFixture } from './bench-runner-fixture.js';

const receipt = benchmark => JSON.stringify({ schemaVersion: BENCH_TERMINAL_RECEIPT_VERSION, kind: 'bench-terminal',
  status: 'skipped', benchmark, reason: 'optional-backend-unavailable' });
const missing = { baseline: null, current: null, delta: null };
const pure = overrides => classifyBenchOutcome({ result: { stdout: receipt('fixture'), exitCode: 0,
  timedOut: false, signal: null, parsed: missing, ...overrides }, id: 'fixture',
expect: { baseline: true }, allowSkip: true, suiteMode: true });
assert.equal(pure({}).status, 'skipped');
for (const failed of [{ exitCode: 1 }, { exitCode: null }, { signal: 'SIGTERM' }, { processFailure: 'EIO' }]) {
  const result = pure(failed);
  assert.equal(result.status, 'error');
  assert.equal(result.skipped, false);
}
assert.equal(pure({ timedOut: true, exitCode: null }).status, 'timeout');
for (const stdout of ['a substep was skipped', '[bench] skipping after failure', `${receipt('other')}`,
  `${receipt('fixture')}\nordinary trailer`]) assert.equal(pure({ stdout }).status, 'error');
assert.equal(pure({ parsed: { baseline: { metrics: {} } } }).status, 'error', 'a skip cannot coexist with completed expected metrics');
assert.equal(readBenchSkipReceipt(JSON.stringify({ ...JSON.parse(receipt('fixture')), extra: true }), 'fixture'), null);

const fixture = await createBenchRunnerFixture('bench-terminal-outcomes');
const make = async (id, exitCode, stdout, allowSkip = true) => ({ id,
  script: await fixture.writeFixture(id, [`console.log(${JSON.stringify(stdout)});`, `process.exitCode = ${exitCode};`]),
  args: [], expect: { baseline: true }, allowSkip });
const entries = [
  await make('valid-skip', 0, receipt('valid-skip')),
  await make('failed-skip', 1, receipt('failed-skip')),
  await make('incidental', 0, 'a substep was skipped'),
  await make('required', 0, receipt('required'), false),
  await make('complete', 0, '[bench] baseline duration=1ms')
];
const argv = { suite: 'fixture', scripts: [], json: null, quiet: true, timeoutMs: 2000 };
const { report, exitCode } = await runBenchRunner({ argv, resolveSuite: () => entries });
assert.equal(exitCode, 1, 'the actual suite orchestration cannot exit zero with failed skip-looking children');
assert.deepEqual(Object.fromEntries(['ok', 'error', 'timeout', 'skipped'].map(key => [key, report.summary[key]])),
  { ok: 1, error: 3, timeout: 0, skipped: 1 });
assert.deepEqual(report.results.map(row => row.status), ['skipped', 'error', 'error', 'error', 'ok']);
assert.equal(report.results[0].processOk, true);
assert.equal(report.results[0].parsedOk, false);
assert.equal(report.results[0].skipReason, 'optional-backend-unavailable');
assert.equal(report.results[1].exitCode, 1);
assert.equal(report.results[1].skipReason, null);
assert.ok(report.results[1].errors.includes('missing baseline bench line'));
const valid = await runBenchRunner({ argv, resolveSuite: () => [entries[0], entries[4]] });
assert.equal(valid.exitCode, 0, 'the recognized optional skip stays a valid suite disposition');
assert.equal(valid.report.summary.ok, 1);
assert.equal(valid.report.summary.skipped, 1);
for (const facts of [{ signal: 'SIGTERM', exitCode: 0 }, { processFailure: 'SPAWN_FAILURE', exitCode: null },
  { timedOut: true, exitCode: null }]) {
  const result = await runBenchRunner({ argv, resolveSuite: () => [entries[0]], run: () => ({
    stdout: receipt('valid-skip'), stderr: '', parsed: missing, json: null, exitCode: 0, durationMs: 1,
    startedAtMs: 0, endedAtMs: 1, timedOut: false, signal: null, ...facts }) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.results[0].skipped, false);
  assert.equal(result.report.results[0].status, facts.timedOut ? 'timeout' : 'error');
}
console.log('benchmark terminal receipt and process-failure precedence through actual orchestration test passed');
