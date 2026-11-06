import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureCommandTerminalRun } from '../../../tools/testing/search-debug-capture.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { isProcessAlive } from '../../../src/shared/locks/file-lock-owner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/bootstrap-terminal-status/')[1];
assert.ok(['terminal-80x24-no-color', 'terminal-120x30-no-color', 'pipe-json-stdout'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir('bootstrap-terminal-status-' + mode);
const receiptPath = path.join(dir, 'receipt.json'), fixture = path.resolve('tests/fixtures/bootstrap-terminal-status.js');
const env = { ...process.env, NO_COLOR: '1', NODE_DISABLE_COLORS: '1' }; delete env.FORCE_COLOR;
let summary;
if (mode === 'pipe-json-stdout') {
  const result = await spawnSubprocess(process.execPath, [fixture, receiptPath, 'pipe'], {
    cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'], timeoutMs: 10000, maxOutputBytes: 65536,
    windowsHide: true, rejectOnNonZeroExit: false
  });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.signal, null);
  assert.deepEqual(JSON.parse(result.stdout), { kind: 'bootstrap-terminal-status-fixture', sentinel: 'BOOTSTRAP-STATUS-DONE' });
  summary = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(summary.stdoutTTY, false); assert.equal(summary.stderrTTY, false); assert.equal(result.stderr, summary.rawStatus);
} else {
  const [columns, rows] = mode.includes('80x24') ? [80, 24] : [120, 30]; let pid;
  const capture = await captureCommandTerminalRun({ command: process.execPath, args: [fixture, receiptPath, 'pty'],
    rootDir: process.cwd(), cwd: process.cwd(), env, forceColor: false, cols: columns, rows, timeoutMs: 10000,
    trackedEnvKeys: ['NO_COLOR', 'NODE_DISABLE_COLORS'],
    label: mode, logsRoot: path.join(dir, 'capture'), onSpawn: terminal => { pid = terminal.pid; }
  });
  assert.equal(capture.timedOut, false); assert.equal(capture.exitCode, 0); assert.ok(!capture.signal);
  summary = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  assert.equal(summary.pid, pid); assert.equal(isProcessAlive(pid), false, 'actual terminal exit retires the launched fixture child');
  assert.equal(summary.stdoutTTY, true); assert.equal(summary.stderrTTY, true);
  assert.equal(summary.columns, columns); assert.equal(summary.rows, rows);
  assert.equal(capture.terminal.columns, columns); assert.equal(capture.terminal.rows, rows);
  const screen = (await fs.readFile(capture.files.screenTxt, 'utf8')).replace(/\s+/g, ' ');
  for (const text of ['compiler started', 'compiler succeeded', 'probe started', 'probe succeeded', 'optional failed (optional)', 'BOOTSTRAP-STATUS-DONE']) {
    assert.ok(screen.includes(text), `actual ${process.platform} terminal ${columns}x${rows} lost status: ${text}; ${capture.outputDir}`);
  }
}
assert.equal(summary.platform, process.platform); assert.equal(summary.noColor, true); assert.equal(summary.rootRetired, true);
assert.deepEqual(summary.runtime, { node: process.version, abi: process.versions.modules, executable: process.execPath });
assert.doesNotMatch(summary.rawStatus, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
assert.match(summary.rawStatus, /expected optional fixture unavailable/);
assert.deepEqual(summary.states, [{ id: 'compiler', status: 'succeeded' }, { id: 'probe', status: 'succeeded' }, { id: 'optional', status: 'failed' }]);
for (const row of summary.states) {
  assert.equal(summary.emittedStates.filter(event => event.id === row.id && event.state === row.status).length, 1);
}
console.log(JSON.stringify({ mode, platform: process.platform, backend: mode === 'pipe-json-stdout' ? 'pipe' : process.platform === 'win32' ? 'ConPTY' : 'PTY',
  receiptPath, qualification: 'actual-platform-only; no cross-platform substitution' }));
