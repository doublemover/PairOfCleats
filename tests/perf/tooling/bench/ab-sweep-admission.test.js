import assert from 'node:assert/strict';
import { qualifySweepRuns } from '../../../../tools/bench/ab-sweep-admission.js';
import { BENCH_RUNNER_REPORT_VERSION } from '../../../../tools/bench/runner-contract.js';
import { BENCH_WORKLOAD_VERSION, BENCH_EXPERIMENT_VERSION, benchmarkFingerprint } from '../../../../tools/bench/runner-workload.js';
import { BENCH_OBSERVATION_VERSION } from '../../../../tools/bench/runner-observation.js';

const identity = benchmarkFingerprint({ independent: 'input' });
const source = { state: 'observed', sha256: 'b'.repeat(64), bytes: 123 };
const makeWorkload = optional => {
  const body = { version: BENCH_WORKLOAD_VERSION, suite: 'fixture', tokens: {}, timeoutMs: 1000,
    entries: [{ ordinal: 0, id: 'required', absScript: '/fixture/required.js', args: [], required: true, source },
      ...(optional ? [{ ordinal: 1, id: 'optional', absScript: '/fixture/optional.js', args: [], required: false, source }] : [])] };
  return { ...body, fingerprint: benchmarkFingerprint(body) };
};
const witness = { state: 'clean-revision', revision: 'c'.repeat(40) };
const observation = durationMs => ({ version: BENCH_OBSERVATION_VERSION, scope: 'fixture',
  workload: { id: 'same-completed-work', producerVersion: 'independent-v1', units: 1000, dataIdentity: identity, configurationIdentity: identity },
  correctness: { state: 'passed', checks: ['independent-content-check'] }, metrics: { durationMs },
  knobs: { cpuTokens: { state: 'applied', value: 2 } } });
const makeRun = (workload, number, durationMs) => {
  const experiment = { version: BENCH_EXPERIMENT_VERSION, experimentId: '00000000-0000-0000-0000-000000000001',
    variantId: `variant-${String(number).padStart(6, '0')}`, requestFingerprint: identity,
    workloadFingerprint: workload.fingerprint, maxReportBytes: 65536 };
  return { runId: `run-${number}`, variant: { cpuTokens: 2 }, status: 0, signal: null, experiment,
    report: { schemaVersion: BENCH_RUNNER_REPORT_VERSION, workload, experiment, reportAdmission: { state: 'complete' },
      sourceValidation: workload.entries.map(entry => ({ ordinal: entry.ordinal, ...source, state: 'unchanged' })),
      runner: { platform: 'win32', arch: 'x64', node: 'v26.12.1', cpuModel: 'fixture-cpu', logicalCpuCount: 2,
        storageTier: 'disk', storagePath: '/fixture/index' },
      results: workload.entries.map(entry => ({ ...entry, status: 'ok', ok: true, processOk: true, parsedOk: true,
        exitCode: 0, skipped: false, outputCapture: { stdout: { enabled: true, truncated: false, encodingLoss: false, droppedBytes: 0 } },
        json: { benchmarkObservation: observation(durationMs) } })) } };
};
const qualify = (workload, runs, extra = {}) => qualifySweepRuns({ workload, runs, sourceBefore: witness, sourceAfter: witness, ...extra });
const workload = makeWorkload(false);
const slow = makeRun(workload, 1, 10_000_000);
const fastFailure = makeRun(workload, 2, 0.01);
fastFailure.status = 7;
fastFailure.report.results[0].status = 'error';
fastFailure.report.results[0].exitCode = 7;
const selected = qualify(workload, [slow, fastFailure]);
assert.equal(selected.recommendation.bestRunId, 'run-1', 'no finite failure penalty may beat a completed slow run');
assert.equal(selected.runs[1].score, null);
assert.ok(selected.runs[1].eligibility.reasons.includes('child-process-failed'));

const cases = [
  ['all-failed', run => { run.status = 1; }, 'child-process-failed'],
  ['all-required-skipped', run => { Object.assign(run.report.results[0], { status: 'skipped', skipped: true }); }, 'script-not-completed:required'],
  ['missing-duration', run => { delete run.report.results[0].json.benchmarkObservation.metrics.durationMs; }, 'duration-unavailable:required'],
  ['string-duration', run => { run.report.results[0].json.benchmarkObservation.metrics.durationMs = '0.1'; }, 'duration-unavailable:required'],
  ['zero-duration', run => { run.report.results[0].json.benchmarkObservation.metrics.durationMs = 0; }, 'duration-unavailable:required'],
  ['correctness', run => { run.report.results[0].json.benchmarkObservation.correctness.state = 'failed'; }, 'correctness-unqualified:required'],
  ['partial-work', run => { run.report.results[0].json.benchmarkObservation.workload.units = 0; }, 'unqualified-workload-identity:required'],
  ['missing-report', run => { run.report = null; run.reportError = 'missing-report'; }, 'missing-report'],
  ['malformed-report', run => { run.report = null; run.reportError = 'malformed-report'; }, 'malformed-report'],
  ['coverage', run => { run.report.results = []; }, 'script-coverage-mismatch'],
  ['config-mismatch', run => { run.report = structuredClone(run.report); run.report.workload.fingerprint = identity; }, 'resolved-workload-mismatch'],
  ['invocation', run => { run.report.experiment = { ...run.experiment, variantId: 'variant-999999' }; }, 'invocation-receipt-mismatch'],
  ['source-change', run => { run.report.sourceValidation[0].state = 'changed'; }, 'entry-source-changed'],
  ['incomplete-report', run => { run.report.reportAdmission.state = 'report-too-large'; }, 'report-admission-incomplete'],
  ['truncation', run => { run.report.results[0].outputCapture.stdout.truncated = true; }, 'measurement-capture-incomplete:required'],
  ['lossy-encoding', run => { run.report.results[0].outputCapture.stdout.encodingLoss = true; }, 'measurement-capture-incomplete:required'],
  ['unknown-knob', run => { delete run.report.results[0].json.benchmarkObservation.knobs.cpuTokens; }, 'knob-unverified:cpuTokens:required'],
  ['unsupported-knob', run => { run.report.results[0].json.benchmarkObservation.knobs.cpuTokens = { state: 'unsupported' }; }, 'knob-not-applied:cpuTokens'],
  ['wrong-effective-knob', run => { run.report.results[0].json.benchmarkObservation.knobs.cpuTokens.value = 99; }, 'knob-value-mismatch:cpuTokens:required'],
  ['unknown-host', run => { run.report.runner.logicalCpuCount = null; }, 'host-observation-unqualified']
];
for (const [name, mutate, reason] of cases) {
  const run = structuredClone(makeRun(workload, 1, 8)); mutate(run);
  const result = qualify(workload, [run]);
  assert.equal(result.recommendation, null, name);
  assert.equal(result.runs[0].score, null, name);
  assert.ok(result.runs[0].eligibility.reasons.includes(reason), `${name}: ${result.runs[0].eligibility.reasons}`);
}
const incompatible = makeRun(workload, 2, 1);
incompatible.report.results[0].json.benchmarkObservation.workload.dataIdentity = benchmarkFingerprint({ other: 'input' });
const mismatch = qualify(workload, [makeRun(workload, 1, 8), incompatible]);
assert.equal(mismatch.recommendation, null, 'an incompatible cohort cannot select an arbitrary reference group');
assert.ok(mismatch.runs.every(run => run.eligibility.reasons.includes('observed-workload-or-host-mismatch')));
assert.equal(qualify(workload, [slow], { sourceAfter: { ...witness, revision: 'd'.repeat(40) } }).recommendation, null);
assert.equal(qualify(workload, [slow], { sourceBefore: { ...witness, state: 'dirty' } }).recommendation, null);
const incomplete = qualify(workload, [slow, { ...fastFailure, notRunReason: 'cancelled' }]);
assert.equal(incomplete.recommendation, null); assert.equal(incomplete.outcome, 'incomplete-experiment');

const withOptional = makeWorkload(true);
const optionalRuns = [makeRun(withOptional, 1, 8), makeRun(withOptional, 2, 5)];
for (const run of optionalRuns) Object.assign(run.report.results[1], { status: 'skipped', skipped: true, skipReason: 'backend-unavailable', ok: false, parsedOk: false });
const common = qualify(withOptional, optionalRuns);
assert.equal(common.recommendation.bestRunId, 'run-2');
assert.equal(common.coverage.measuredScriptsPerEligibleVariant, 1);
assert.deepEqual(common.exclusions, [{ ordinal: 1, id: 'optional', reason: 'backend-unavailable' }]);
const oneSided = structuredClone(optionalRuns);
oneSided[0].report.results[1] = makeRun(withOptional, 1, 8).report.results[1];
const partial = qualify(withOptional, oneSided);
assert.equal(partial.recommendation.bestRunId, 'run-1', 'one-sided skipped work cannot win');
assert.deepEqual(partial.exclusions, []);
assert.equal(partial.runs[1].eligibility.eligible, false);
console.log('A/B sweep hard admission test passed');
