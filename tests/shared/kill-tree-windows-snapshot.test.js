import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { WINDOWS_PROCESS_SNAPSHOT_SCRIPT, resolveWindowsDescendantPids } from '../../src/shared/kill-tree/windows.js';

if (process.platform === 'win32') {
  const windowsRoot = process.env.SystemRoot;
  assert.ok(windowsRoot && path.isAbsolute(windowsRoot));
  const helpers = ['System32'];
  if (fs.existsSync(path.join(windowsRoot, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))) helpers.push('SysWOW64');
  for (const directory of helpers) {
    const executable = path.join(windowsRoot, directory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const run = script => spawnSync(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 2000, windowsHide: true
    });
    const result = run(WINDOWS_PROCESS_SNAPSHOT_SCRIPT);
    assert.equal(result.error, undefined, `${directory}: snapshot must finish within the production deadline`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /lineage:snapshot-ready/);
    assert.match(result.stderr, /lineage:resources-closed/);
    assert.match(result.stderr, /lineage:rows-written/);
    assert.ok(resolveWindowsDescendantPids(result.stdout, process.ppid).includes(process.pid),
      `${directory}: real parent/child lineage must survive native struct decoding`);
    const fault = run(WINDOWS_PROCESS_SNAPSHOT_SCRIPT.replace(
      '$more = $native::Process32NextW($snapshot, $buffer)',
      '$more = $native::Process32NextW([IntPtr]::Zero, $buffer)'));
    assert.equal(fault.error, undefined);
    assert.notEqual(fault.status, 0, 'an invalid native enumeration handle cannot report a complete snapshot');
    assert.equal(fault.stdout, '', 'rows accumulated before a native error cannot authorize cleanup');
    assert.match(fault.stderr, /lineage:resources-closed/, 'failure still frees the buffer and closes its actual snapshot');
    assert.doesNotMatch(fault.stderr, /lineage:rows-written/);
    console.log(JSON.stringify({ helper: directory, status: result.status, nativeFailureStatus: fault.status,
      rows: result.stdout.trim().split(/\r?\n/).length }));
  }
} else {
  // Portable authority owner stays active; Windows executes both native layouts when available.
  assert.deepEqual(resolveWindowsDescendantPids('2 1\n3 2\n20 10', 1), [2, 3]);
}
console.log('Native Windows snapshots retain real lineage, close resources and reject incomplete enumeration without publishing partial rows.');
