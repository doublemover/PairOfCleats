import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { resolveWindowsDescendantPids, killWindowsTreeSync, resolveWindowsSystemUtility } from '../../src/shared/kill-tree/windows.js';

const snapshot = '3 2\r\n20 10\r\n2 1\r\n4 2\r\n10 0\r\n5 3\r\n';
assert.deepEqual(resolveWindowsDescendantPids(snapshot, 1), [2, 3, 4, 5], 'a missing parent still owns its recorded descendants');
assert.deepEqual(resolveWindowsDescendantPids(snapshot, 2), [3, 4, 5], 'root itself is never a descendant');
assert.deepEqual(resolveWindowsDescendantPids(snapshot, 10), [20], 'unrelated process trees remain separate');
assert.deepEqual(resolveWindowsDescendantPids(snapshot, 99), []);
assert.deepEqual(resolveWindowsDescendantPids('', 1), []);
assert.deepEqual(resolveWindowsDescendantPids('0 0\n2 1', 1), [2], 'system idle PID zero is not a kill target');
assert.deepEqual(resolveWindowsDescendantPids('2 1\n1 2\n3 2', 1), [2, 3], 'PID cycles cannot revisit the root');
assert.deepEqual(resolveWindowsDescendantPids('4294967295 1\n2 4294967295', 1), [4294967295, 2]);
for (const invalid of ['1', '2 -1', '-2 1', '2.5 1', '2 1\n2 3', '2 1\npartial', '4294967296 1', '2 4294967296']) {
  assert.throws(() => resolveWindowsDescendantPids(invalid, 1), { code: 'ERR_WINDOWS_PROCESS_SNAPSHOT' }, invalid);
}
const count = 10000;
const chain = Array.from({ length: count }, (_, index) => `${index + 2} ${index + 1}`).join('\n');
const descendants = resolveWindowsDescendantPids(chain, 1);
assert.equal(descendants.length, count);
assert.deepEqual([descendants[0], descendants.at(-1)], [2, count + 1]);

assert.equal(resolveWindowsSystemUtility('taskkill', { SystemRoot: 'C:\\Windows', PATH: 'untrusted' }), 'C:\\Windows\\System32\\taskkill.exe');
assert.equal(resolveWindowsSystemUtility('tasklist', { windir: 'D:\\Windows' }), 'D:\\Windows\\System32\\tasklist.exe');
for (const SystemRoot of ['relative', '\\Windows', '']) assert.equal(resolveWindowsSystemUtility('taskkill', { SystemRoot }), null);
for (const name of ['cmd', 'powershell', '__proto__', '../taskkill', null]) assert.equal(resolveWindowsSystemUtility(name, { SystemRoot: 'C:\\Windows' }), null);

// Observe the actual cleanup owner without launching or killing any process.
// CWD/PATH must not choose replacements for Windows system utilities.
const originalSpawn = childProcess.spawnSync, originalSystemRoot = process.env.SystemRoot;
const launches = [];
const observeLaunch = (command, args, options) => {
  launches.push({ command, args, options });
  return { status: 0, stdout: /tasklist(?:\.exe)?$/i.test(String(command)) ? 'INFO: No tasks are running' : '', stderr: '' };
};
try {
  process.env.SystemRoot = 'C:\\Windows';
  childProcess.spawnSync = observeLaunch; syncBuiltinESMExports();
  assert.equal((await import('node:child_process')).spawnSync, observeLaunch, 'the leaf is intercepted before any process operation');
  assert.equal(killWindowsTreeSync(43210).terminated, true);
  assert.deepEqual(launches.map(row => row.command), [
    'C:\\Windows\\System32\\taskkill.exe', 'C:\\Windows\\System32\\tasklist.exe'
  ], 'Cleanup executes the selected system binaries without CWD/PATH command lookup');
  assert.ok(launches.every(row => row.options.windowsHide === true && row.options.timeout === 2000));
  console.log(JSON.stringify({ helperAuthority: launches.map(row => ({ command: row.command, args: row.args,
    windowsHide: row.options.windowsHide, timeoutMs: row.options.timeout })) }));
} finally {
  childProcess.spawnSync = originalSpawn; syncBuiltinESMExports();
  if (originalSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = originalSystemRoot;
}

console.log('Windows PID snapshot walking preserves orphan lineage, cycles, authority and malformed-input rejection.');
