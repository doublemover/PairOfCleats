import assert from 'node:assert/strict';
import { runSetupPreflight } from '../../../tools/setup/preflight.js';
import { spawnResolvedSubprocessSync } from '../../../src/shared/subprocess/command-invocation.js';

const python = { version: [3, 15, 2], executable: '/explicit/fixture-python', releaselevel: 'final', serial: 0 };
const calls = [];
const fixtureRun = (command, args, options) => {
  calls.push({ command, args, timeout: options.timeout });
  if (command === '/explicit/cold-python') {
    const result = spawnResolvedSubprocessSync(process.execPath, ['-e',
      `setTimeout(() => console.log(${JSON.stringify(JSON.stringify(python))}), 3500);`], {
      timeoutMs: options.timeout, stdio: 'pipe', captureStdout: true, captureStderr: true,
      outputEncoding: 'utf8', rejectOnNonZeroExit: false
    });
    return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }
  const stdout = command === 'git' ? 'git version 2.53.0' : command === 'make' ? 'GNU Make 4.4'
    : command === 'c++' ? 'clang 22.1.0' : '';
  return { status: stdout ? 0 : 1, stdout };
};
const options = { nodeVersion: '26.13.0', platform: 'linux', arch: 'x64',
  env: { NODE_GYP_FORCE_PYTHON: '/explicit/cold-python' }, run: fixtureRun };
const report = runSetupPreflight(options);
assert.deepEqual(report.python.version, [3, 15, 2]);
assert.equal(calls.filter(row => row.command === '/explicit/cold-python').length, 1, 'one original probe, no status retry');
assert.ok(!calls.some(row => ['py', 'python3', 'python'].includes(row.command)), 'explicit Python never uses an ambient fallback');
assert.ok(calls.every(row => row.timeout <= 10000), 'bounded discovery does not become an unbounded native qualification');

for (const [failure, pattern] of [
  [{ status: null, error: { code: 'ETIMEDOUT' } }, /timed out after 10000ms/],
  [{ status: null, error: { code: 'ENOENT' } }, /ENOENT/],
  [{ status: 17, stdout: '', stderr: 'fixture interpreter refused' }, /exit 17/]
]) {
  let probes = 0;
  assert.throws(() => runSetupPreflight({ ...options, run: (command, args, input) => {
    if (command === '/explicit/cold-python') { probes++; return failure; }
    return fixtureRun(command, args, input);
  } }), pattern);
  assert.equal(probes, 1);
}
for (const failure of [null, undefined, false, 0]) assert.throws(() => runSetupPreflight({ ...options,
  run: (command, args, input) => { if (command === '/explicit/cold-python') throw failure; return fixtureRun(command, args, input); }
}), /Explicit NODE_GYP_FORCE_PYTHON/, 'unusual synchronous probe failures retain the original selection blocker');
console.log('Cold prerequisite startup receives one bounded discovery probe; missing, timed-out and failing explicit interpreters remain distinct blockers.');
