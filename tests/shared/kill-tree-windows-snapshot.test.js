import assert from 'node:assert/strict';
import { runSyncCommandWithTimeout } from '../../src/shared/subprocess/sync-command.js';
import { WINDOWS_PROCESS_SNAPSHOT_SCRIPT, createWindowsProcessSnapshotRequest,
  resolveWindowsDescendantPids, resolveWindowsPowerShellPath } from '../../src/shared/kill-tree/windows.js';

assert.equal(resolveWindowsPowerShellPath({ SystemRoot: 'C:\\Windows', PATH: 'untrusted' }), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
assert.equal(resolveWindowsPowerShellPath({ windir: 'D:\\Windows' }), 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
assert.equal(resolveWindowsPowerShellPath({ SystemRoot: 'relative' }), null);
assert.equal(resolveWindowsPowerShellPath({ SystemRoot: '\\Windows' }), null);
assert.equal(resolveWindowsPowerShellPath({}), null);
assert.equal(createWindowsProcessSnapshotRequest({ env: { SystemRoot: 'relative' } }), null);
const request = createWindowsProcessSnapshotRequest({ env: { SystemRoot: 'C:\\Windows', PATH: 'untrusted' } });
assert.equal(request.command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
assert.equal(request.options.timeoutMs, 2000, 'the actual discovery deadline remains unchanged');
assert.equal(request.options.input, WINDOWS_PROCESS_SNAPSHOT_SCRIPT);
assert.equal(request.args.includes(WINDOWS_PROCESS_SNAPSHOT_SCRIPT), false, 'the fixed launcher separates engine and payload parsing');
assert.deepEqual(request.options.stdio, ['pipe', 'pipe', 'pipe']);

if (process.platform === 'win32') {
  const executable = resolveWindowsPowerShellPath(process.env);
  assert.ok(executable, 'the production native helper must have an absolute system path');
  const run = script => {
    const { command, args, options } = createWindowsProcessSnapshotRequest({ script });
    return runSyncCommandWithTimeout(command, args, { ...options, env: { ...process.env, PATH: '' } });
  };
  const result = run(WINDOWS_PROCESS_SNAPSHOT_SCRIPT);
  assert.equal(result.error, undefined, `production helper deadline: ${JSON.stringify({ executable,
    status: result.status, errorCode: result.error?.code, stderr: result.stderr?.slice(-2048) })}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /lineage:engine-ready/);
  assert.ok(result.stderr.indexOf('lineage:engine-ready') < result.stderr.indexOf('lineage:script-start'));
  assert.match(result.stderr, /lineage:snapshot-ready/);
  assert.match(result.stderr, /lineage:resources-closed/);
  assert.match(result.stderr, /lineage:rows-written/);
  assert.ok(resolveWindowsDescendantPids(result.stdout, process.ppid).includes(process.pid),
    'real parent/child lineage must survive native struct decoding');
  const fault = run(WINDOWS_PROCESS_SNAPSHOT_SCRIPT.replace(
    '$more = $native::Process32NextW($snapshot, $buffer)',
    '$more = $native::Process32NextW([IntPtr]::Zero, $buffer)'));
  assert.equal(fault.error, undefined, `native failure control: ${JSON.stringify({ executable,
    status: fault.status, errorCode: fault.error?.code, stderr: fault.stderr?.slice(-2048) })}`);
  assert.notEqual(fault.status, 0, 'an invalid native enumeration handle cannot report a complete snapshot');
  assert.match(fault.stderr, /lineage:engine-ready/);
  assert.equal(fault.stdout, '', 'rows accumulated before a native error cannot authorize cleanup');
  assert.match(fault.stderr, /lineage:resources-closed/, 'failure still frees the buffer and closes its actual snapshot');
  assert.doesNotMatch(fault.stderr, /lineage:rows-written/);
  for (const payload of ["throw 'explicit snapshot payload failure'", 'try {']) {
    const invalid = run(payload);
    assert.equal(invalid.error, undefined, 'payload failures settle within the production deadline');
    assert.notEqual(invalid.status, 0, 'stdin parsing/execution errors remain failed commands');
    assert.equal(invalid.stdout, '', 'a failed payload cannot authorize any lineage rows');
    assert.match(invalid.stderr, /lineage:engine-ready/, 'the engine boundary precedes payload parsing and execution');
    assert.doesNotMatch(invalid.stderr, /lineage:rows-written/);
  }
  console.log(JSON.stringify({ helper: executable, arch: process.arch, status: result.status, nativeFailureStatus: fault.status,
    rows: result.stdout.trim().split(/\r?\n/).length }));
} else {
  // Portable authority stays active; Windows executes its actual production helper.
  assert.deepEqual(resolveWindowsDescendantPids('2 1\n3 2\n20 10', 1), [2, 3]);
}
console.log('Native Windows snapshots retain real lineage, close resources and reject incomplete enumeration without publishing partial rows.');
