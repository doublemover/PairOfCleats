import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runBenchRuntimeLiveCanary, runBenchRuntimeCanaryLane, buildBenchRuntimeLiveCanarySummary } from '../../../tools/bench/language/canaries.js';
import { getCanaryAttemptOwner } from '../../../tools/bench/language/canary-attempt.js';
import { publishBenchRuntimeCanarySummary } from '../../../tools/bench/language/canary-reports.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = process.cwd(), { dir } = await prepareTestCacheDir('canary-attempt-lifecycle');
const script = path.join(root, 'tests/fixtures/bench-runtime-canaries/live/attempt-lifecycle.js');
const entry = mode => ({ id: mode, issue: 1665, environment: { toolchain: 'node only' },
  runner: { type: 'node-script', script, args: [mode, '{outJson}'], timeoutMs: mode === 'timeout' ? 750 : 5000 },
  currentContract: { allowedResultClasses: ['passed'] }, targetContract: { allowedResultClasses: ['passed'] } });
const probeRunner = probe => ({ available: true, exitCode: 0, version: 'explicit-synthetic-probe',
  ...(probe.id === 'node' ? { runtime: { nodeVersion: process.version, platform: process.platform, arch: process.arch } } : {}) });
const options = { probeRunner, limits: { captureBytes: 1024, resultBytes: 1024 } };
const absent = async target => { await assert.rejects(fs.stat(target), error => error.code === 'ENOENT'); };

for (const mode of ['valid', 'flood', 'stdout']) {
  const result = await runBenchRuntimeLiveCanary(entry(mode), root, options);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.metrics.resultClass, 'passed');
  assert.equal(result.resultAdmission.state, 'complete');
  assert.match(result.resultAdmission.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.resultAdmission.source, mode === 'stdout' ? 'stdout' : 'artifact');
  assert.equal(result.attempt.state, 'removed');
  await absent(result.attempt.workDir);
  assert.equal(result.closureReady, false, 'synthetic probes never qualify production blocker closure');
  for (const stream of ['stdout', 'stderr']) {
    const capture = result.outputCapture[stream];
    assert.ok(Buffer.byteLength(result[stream]) <= 1024);
    assert.ok(capture.retainedBytes <= 1024 && capture.retainedBufferBytes <= 1024);
    assert.equal(typeof capture.encodingLoss, 'boolean');
    if (mode === 'flood') {
      assert.ok(capture.observedBytes > 100 * 1024);
      assert.equal(capture.truncated, true);
      assert.equal(capture.observedBytes, capture.retainedBytes + capture.droppedBytes);
    }
  }
}
const regressed = await runBenchRuntimeLiveCanary({ ...entry('valid'),
  forbiddenRegressions: [{ type: 'resultClassDisallowed', values: ['passed'] }] }, root, options);
assert.equal(regressed.current.ok, true); assert.equal(regressed.status, 'regressed');
assert.equal(regressed.ok, false); assert.equal(regressed.closureReady, false);
const failures = { malformed: 'ERR_CANARY_RESULT_PARSE', oversized: 'ERR_FILE_TOO_LARGE', unreadable: 'EISDIR',
  'invalid-schema': 'ERR_CANARY_RESULT_SCHEMA', 'invalid-encoding': 'ERR_CANARY_RESULT_PARSE',
  missing: 'ERR_CANARY_RESULT_PARSE', 'truncated-stdout': 'ERR_CANARY_RESULT_INCOMPLETE', nonzero: 'SUBPROCESS_FAILED', timeout: 'SUBPROCESS_TIMEOUT' };
for (const [mode, code] of Object.entries(failures)) {
  const result = await runBenchRuntimeLiveCanary(entry(mode), root, options);
  assert.equal(result.status, 'runner_failed', mode);
  assert.equal(result.ok, false); assert.equal(result.closureReady, false);
  assert.equal(result.errorCode, code, JSON.stringify(result));
  assert.equal(result.attempt.state, 'removed', mode);
  await absent(result.attempt.workDir);
  if (mode === 'timeout') assert.equal(result.termination.closeObserved, true);
}

const lane = await runBenchRuntimeCanaryLane([entry('valid'), entry('malformed'), entry('valid')], root, options);
assert.equal(lane.ok, false); assert.equal(lane.canaries.length, 3);
assert.deepEqual(lane.canaries.map(row => row.status), ['target_achieved', 'runner_failed', 'target_achieved']);
assert.equal(lane.coverage.complete, true); assert.equal(lane.coverage.attempted, 3);
assert.equal(lane.canaries[1].errorPhase, 'result-admission');
const checkpoint = path.join(dir, 'summary.json');
const markdown = path.join(dir, 'summary.md');
await publishBenchRuntimeCanarySummary(lane, { outJsonPath: checkpoint, outMdPath: markdown });
assert.deepEqual(JSON.parse(await fs.readFile(checkpoint, 'utf8')), lane, 'atomic report retains earlier and later selected observations');
assert.ok((await fs.readFile(markdown, 'utf8')).includes('malformed: runner_failed'));
const noIssueFailure = buildBenchRuntimeLiveCanarySummary([{ id: 'unassigned', status: 'runner_failed', ok: false }]);
assert.equal(noIssueFailure.ok, false, 'failure without an issue number cannot become a passing lane');

// Controlled shared-runner contract failure: no real orphan, elevation or new
// supervisor. Release comes only from the exact original observer below.
let released = false, calls = 0, receivedOptions, workDir;
const primary = Object.freeze(Object.assign(new Error('fixture close not yet observed'), { code: 'SUBPROCESS_TIMEOUT',
  cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, primary); return released; },
  result: { exitCode: null, signal: null, stdout: '', stderr: '', termination: { closeObserved: false, treeCleanupSettled: true } } }));
const subprocessRunner = async (_cmd, args, opts) => {
  calls++; receivedOptions = opts; workDir = path.dirname(args.at(-1)); throw primary;
};
const pending = await runBenchRuntimeLiveCanary(entry('valid'), root, { ...options, subprocessRunner });
assert.equal(receivedOptions.onStdout, undefined); assert.equal(receivedOptions.onStderr, undefined);
assert.equal(receivedOptions.maxOutputBytes, 1024);
assert.equal(pending.originalFailure, primary); assert.equal(JSON.stringify(pending).includes('cacheOwnershipReleased'), false);
assert.equal(pending.attempt.ownershipPending, true); assert.equal(pending.termination.closeObserved, false);
assert.equal((await fs.stat(workDir)).isDirectory(), true);
const owner = getCanaryAttemptOwner(pending);
await assert.rejects(owner.releaseAfterSettlement());
const unrelated = path.join(dir, 'unrelated'); await fs.mkdir(unrelated); await fs.writeFile(path.join(unrelated, 'keep'), 'keep');
released = true;
assert.deepEqual(await Promise.all([owner.releaseAfterSettlement(), owner.releaseAfterSettlement()]), [true, true]);
assert.equal(await owner.releaseAfterSettlement(), true);
await absent(workDir); assert.equal(await fs.readFile(path.join(unrelated, 'keep'), 'utf8'), 'keep');

released = false;
const stopped = await runBenchRuntimeCanaryLane([entry('first'), entry('second')], root, { ...options, subprocessRunner });
assert.equal(calls, 2); assert.equal(stopped.coverage.notRun, 1); assert.equal(stopped.coverage.complete, false);
assert.equal(stopped.canaries[1].notRunReason, 'prior-attempt-ownership-pending');
assert.equal((await fs.stat(workDir)).isDirectory(), true);
// Controlled observer cleanup does not reinterpret the recorded failed run.
released = true;
await getCanaryAttemptOwner(stopped.canaries[0]).releaseAfterSettlement();
await absent(workDir);
assert.equal(getCanaryAttemptOwner(JSON.parse(JSON.stringify(stopped.canaries[0]))), null,
  'serialized diagnostics never manufacture cleanup authority');

released = false;
const replaced = await runBenchRuntimeLiveCanary(entry('replacement'), root, { ...options, subprocessRunner });
const originalPath = workDir, movedPath = originalPath + '-original';
await fs.rename(originalPath, movedPath);
await fs.mkdir(originalPath); await fs.writeFile(path.join(originalPath, 'keep'), 'replacement');
released = true;
await assert.rejects(getCanaryAttemptOwner(replaced).releaseAfterSettlement(), error => error.code === 'ERR_PERSISTENCE_DIRECTORY_CHANGED');
assert.equal(await fs.readFile(path.join(originalPath, 'keep'), 'utf8'), 'replacement');
await fs.unlink(path.join(originalPath, 'keep')); await fs.rmdir(originalPath);
await fs.rename(movedPath, originalPath);
await getCanaryAttemptOwner(replaced).releaseAfterSettlement();
await absent(originalPath);

const controller = new AbortController();
const cancelled = await runBenchRuntimeCanaryLane([entry('cancel'), entry('later')], root, { ...options,
  signal: controller.signal, subprocessRunner: async () => {
    controller.abort(); throw Object.assign(new Error('fixture cancellation'), { code: 'ABORT_ERR' });
  } });
assert.equal(cancelled.ok, false); assert.equal(cancelled.coverage.interrupted, 1); assert.equal(cancelled.coverage.notRun, 1);
assert.equal(cancelled.canaries[1].notRunReason, 'cancelled');
console.log('Canary attempts bound diagnostics/results, retain original lifetime authority and account for every selected entry.');
