import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { reconstructTerminalScreen } from '../../tools/testing/terminal-screen.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';

assert.equal(process.platform, 'win32', 'This owner requires actual Windows ConPTY; POSIX needs a real PTY owner');
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir('native-job-selection');
const binary = path.join(root, 'crates/pairofcleats-tui/target/debug/pairofcleats-tui.exe');
const binarySha256 = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
const env = applyTestEnv({ syncProcess: false, extraEnv: {
  PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TUI_NODE: process.execPath,
  PAIROFCLEATS_TUI_SUPERVISOR: path.join(root, 'tests/fixtures/tui/native-job-selection-supervisor.js'),
  PAIROFCLEATS_TUI_RUN_ID: 'job-selection-native', PAIROFCLEATS_TUI_EVENT_LOG_DIR: dir,
  PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(dir, 'state.json')
} });
const readLines = async file => {
  try {
    const body = await fs.readFile(path.join(dir, file), 'utf8');
    return body.slice(0, body.lastIndexOf('\n') + 1).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const events = () => readLines('job-selection-native.jsonl');
const pids = () => readLines('pids.jsonl');
const columns = 240, rows = 48;
try {
  const capture = await captureCommandTerminalRun({ command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile',
    '-NonInteractive', '-File', path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'),
    binary, dir, 'job-selection'], rootDir: root, cwd: root, cols: columns, rows,
  label: 'native-job-selection', logsRoot: path.join(dir, 'capture'), timeoutMs: 22000, env,
  onSpawn: async terminal => {
    let output = '', frame = 0;
    const subscription = terminal.onData(data => { output = (output + data).slice(-1024 * 1024); });
    const deadline = Date.now() + 14000;
    const wait = async (predicate, label) => {
      while (!await predicate()) {
        assert.ok(Date.now() < deadline, `Native selection witness timed out: ${label}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const screen = () => reconstructTerminalScreen(output, { columns, rows }).text;
    const rendered = async label => {
      await wait(() => { const frame = screen(); return frame.includes(label)
        && (label !== 'Tab pane' || /\bconn\s+(?:connected|streaming)\b/.test(frame)); }, label);
      await fs.writeFile(path.join(dir, `screen-${frame++}.txt`), screen());
    };
    try {
      await wait(async () => (await events()).some(event => event.event === 'hello'), 'real supervisor hello');
      await rendered('Tab pane');
      terminal.write('r');
      await wait(async () => (await events()).some(event => event.jobId === 'job-1'
        && event.event === 'task:progress'), 'first real worker progress');
      await wait(() => screen().includes('/10000 files') && screen().includes('elapsed ')
        && screen().includes('last '), 'canonical producer counts and local observation age in the actual wide frame');
      terminal.write('r');
      await wait(async () => (await events()).some(event => event.jobId === 'job-2'
        && event.event === 'task:progress'), 'second real worker progress');
      const workers = (await pids()).filter(row => row.job);
      assert.equal(workers.length, 2); assert.ok(workers.every(row => isProcessAlive(row.job)));
      terminal.write('['); await rendered('selected job-1 (pinned)');
      await wait(async () => (await events()).some(event => event.event === 'task:progress'
        && event.jobId === 'job-2' && event.current >= 5), 'concurrently updating unselected worker');
      await rendered('ALPHA_ONLY_LOG_');
      assert.ok(screen().includes('>job-1 | running'));
      assert.ok(screen().includes('ALPHA_TASK')); assert.equal(screen().includes('BETA_TASK'), false);
      assert.equal(screen().includes('BETA_ONLY_LOG_'), false);
      terminal.write('p'); await rendered('follow paused');
      assert.ok(screen().includes('selected job-1 (pinned)'));
      terminal.write('p'); await rendered('follow live');
      assert.ok(screen().includes('selected job-1 (pinned)'));
      terminal.write('/job-2\r'); await rendered('hidden/unavailable; cancel disabled');
      terminal.write('c'); await rendered('Select a visible running job');
      assert.equal((await pids()).filter(row => row.request === 'job:cancel').length, 0);
      assert.ok(workers.every(row => isProcessAlive(row.job)));
      terminal.write('x'); await rendered('>job-1 | running');
      terminal.write('c');
      await wait(async () => (await events()).some(event => event.event === 'job:end'
        && event.jobId === 'job-1' && event.status === 'cancelled'), 'exact selected cancellation');
      assert.deepEqual((await pids()).filter(row => row.request === 'job:cancel').map(row => row.jobId), ['job-1']);
      assert.equal(isProcessAlive(workers.find(row => row.jobId === 'job-1').job), false);
      assert.equal(isProcessAlive(workers.find(row => row.jobId === 'job-2').job), true);
      assert.ok(screen().includes('selected job-1 (pinned)'));
      terminal.write('r');
      let replacement;
      await wait(async () => {
        replacement = (await pids()).find(row => Number.isInteger(row.job) && row.jobId === 'job-1'
          && row.job !== workers.find(row => row.jobId === 'job-1').job);
        return replacement && (await events()).some(event => event.event === 'task:progress' && event.taskId === 'GAMMA_TASK');
      }, 'real completed-ID reuse with a new owned child');
      await rendered('hidden/unavailable; cancel disabled');
      assert.equal(screen().includes('GAMMA_TASK'), false);
      terminal.write('c'); await rendered('selected job instance expired');
      assert.deepEqual((await pids()).filter(row => row.request === 'job:cancel').map(row => row.jobId), ['job-1']);
      assert.equal(isProcessAlive(replacement.job), true);
      terminal.write('['); await rendered('selected job-2 (pinned)');
      terminal.write(']'); await rendered('GAMMA_TASK');
      assert.equal(screen().includes('ALPHA_TASK'), false);
      assert.equal(screen().includes('ALPHA_ONLY_LOG_'), false);
      terminal.write('c');
      await wait(async () => (await events()).filter(event => event.event === 'job:end'
        && event.jobId === 'job-1' && event.status === 'cancelled').length === 2, 'explicit replacement cancellation');
      assert.deepEqual((await pids()).filter(row => row.request === 'job:cancel').map(row => row.jobId), ['job-1', 'job-1']);
      assert.equal(isProcessAlive(replacement.job), false);
      assert.equal(isProcessAlive(workers.find(row => row.jobId === 'job-2').job), true);
      terminal.write('g'); await rendered('selected job-1 (following)');
      terminal.write('q');
    } finally {
      subscription.dispose(); await fs.writeFile(path.join(dir, 'terminal-output.ansi.log'), output);
    }
  } });
  assert.equal(capture.timedOut, false, capture.outputDir); assert.equal(capture.exitCode, 0, capture.outputDir);
  const receipt = JSON.parse(await fs.readFile(path.join(dir, 'terminal-receipt.json'), 'utf8'));
  assert.equal(receipt.exitCode, 0, receipt.stderr); assert.equal(receipt.stderr, '');
  assert.equal(receipt.terminalRestored, true);
  const witnesses = await pids();
  const owned = [...new Set(witnesses.flatMap(row => ['native', 'proxy', 'supervisor', 'job'].map(key => row[key]).filter(Number.isInteger)))];
  assert.equal(owned.length, 6); assert.deepEqual(owned.filter(isProcessAlive), []);
  const snapshot = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8'));
  assert.deepEqual(snapshot.final_job_statuses, { 'job-1': 'cancelled', 'job-2': 'cancelled' });
  assert.equal(snapshot.selected_job, 'job-2'); assert.equal(snapshot.selected_job_pinned, false);
  console.log(JSON.stringify({ binary, binarySha256, receipt, owned, selectedCancel: 'job-1', capture: capture.outputDir }));
} finally {
  for (const row of await pids()) if (row.proxy && isProcessAlive(row.proxy)) await killProcessTree(row.proxy);
}
