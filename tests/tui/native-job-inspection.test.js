import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { reconstructTerminalScreen } from '../../tools/testing/terminal-screen.js';
import { getMetricsDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tui/native-job-inspection/')[1];
assert.ok(['text', 'json', 'disabled', 'invalid-json', 'truncated', 'incomplete', 'oversized'].includes(mode));
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`native-inspection-${mode}`);
const repo = path.join(dir, 'selected repository');
await fs.mkdir(repo); initGitRepo(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{"threads":1}\n');
await fs.writeFile(path.join(dir, 'inspection-mode.json'), JSON.stringify({ mode, repo }));
const binary = path.join(root, 'crates/pairofcleats-tui/target/debug',
  process.platform === 'win32' ? 'pairofcleats-tui.exe' : 'pairofcleats-tui');
const binarySha256 = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', extraEnv: {
  PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TUI_NODE: process.execPath,
  PAIROFCLEATS_TUI_SUPERVISOR: path.join(root, 'tests/fixtures/tui/native-job-inspection-supervisor.js'),
  PAIROFCLEATS_TUI_WORKSPACE_ROOT: repo, PAIROFCLEATS_TUI_RUN_ID: 'inspection-native',
  PAIROFCLEATS_TUI_EVENT_LOG_DIR: dir, PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(dir, 'state.json')
} });
const metrics = getMetricsDir(repo, loadUserConfig(repo));
assert.ok(path.relative(path.join(dir, 'cache'), metrics).split(path.sep)[0] !== '..');
assert.equal(path.isAbsolute(path.relative(path.join(dir, 'cache'), metrics)), false);
await fs.mkdir(path.join(metrics, 'searchHistory'), { recursive: true });
const readLines = async name => {
  let body;
  try { body = await fs.readFile(path.join(dir, name), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return body.slice(0, body.lastIndexOf('\n') + 1).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
};
const events = async () => {
  const rows = await readLines('inspection-native.jsonl'), chunks = new Map();
  for (const row of [...rows]) {
    if (row.event !== 'event:chunk') continue;
    const parts = chunks.get(row.chunkId) || new Map();
    parts.set(row.chunkIndex, row.chunk); chunks.set(row.chunkId, parts);
    if (parts.size === row.chunkCount) rows.push(JSON.parse(Array.from({ length: row.chunkCount }, (_, index) => parts.get(index)).join('')));
  }
  return rows;
};
const columns = 220, rows = 44;
let finalEnd;
try {
  const launcher = process.platform === 'win32'
    ? { command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'), binary, dir, mode] }
    : { command: 'python3', args: [path.join(root, 'tests/fixtures/tui/native-terminal.py'), binary, dir, mode] };
  const capture = await captureCommandTerminalRun({ ...launcher, rootDir: root, cwd: root,
    cols: columns, rows, label: `native-inspection-${mode}`, logsRoot: path.join(dir, 'capture'),
    timeoutMs: 22000, env, onSpawn: async terminal => {
      let output = '', frame = 0, terminalTail = '';
      const subscription = terminal.onData(data => {
        output = (output + data).slice(-1024 * 1024);
        // Standard terminal wire negotiation only; the application and jobs are real.
        if (process.platform !== 'win32') {
          const wire = terminalTail + data;
          for (let count = wire.split('\x1b[6n').length - 1; count > 0; count--) terminal.write('\x1b[1;1R');
          terminalTail = wire.slice(-3);
        }
      });
      const deadline = Date.now() + 14000;
      const wait = async (predicate, label) => {
        while (!await predicate()) {
          assert.ok(Date.now() < deadline, `Native inspection witness timed out: ${label}`);
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
        await wait(async () => (await events()).some(event => event.event === 'hello'), 'actual supervisor hello');
        await rendered('Tab pane'); terminal.write('r');
        await wait(async () => (await events()).some(event => event.event === 'job:spawn'), 'actual child spawn');
        if (mode === 'incomplete') {
          await wait(async () => (await events()).some(event => event.taskId === 'inspection-partial'), 'actual partial operation');
          terminal.write('v'); await rendered('Capture: pending');
          terminal.write('\x1b');
          await wait(() => !screen().includes('┌Job inspection'), 'inspector closed before cancellation');
          terminal.write('c');
        }
        await wait(async () => { finalEnd = (await events()).find(event => event.event === 'job:end' && !event.internal); return finalEnd; }, 'actual terminal job outcome');
        await wait(async () => (await events()).some(event => event.event === 'job:artifacts'), 'actual artifact inventory');
        if (mode === 'text') {
          // Previously observed metadata must not silently become current authority.
          await fs.rmdir(path.join(metrics, 'searchHistory')); await fs.rmdir(metrics);
          await assert.rejects(fs.stat(metrics), { code: 'ENOENT' });
        }
        terminal.write('v'); await rendered('Process status:');
        assert.equal(finalEnd.attempts, 1); assert.equal(finalEnd.retries, 0);
        assert.ok(screen().includes('Attempts: 1 / configured 1 | retries 0'));
        assert.ok(screen().includes(`Last recorded PID: ${finalEnd.pid || (await events()).find(event => event.event === 'job:spawn').pid}`));
        assert.ok(screen().includes(`Process status: ${mode === 'incomplete' ? 'cancelled' : 'done'}`));
        terminal.write('2');
        const expected = ['text', 'json', 'oversized'].includes(mode) ? 'complete' : mode;
        assert.equal(finalEnd.resultState, expected);
        await rendered(`Capture: ${expected}`);
        if (mode === 'text') await rendered('pairofcleats search');
        else if (mode === 'json') {
          assert.equal(finalEnd.result.ok, true); assert.equal(finalEnd.result.found, true);
          assert.deepEqual(finalEnd.result.errors, []);
          await rendered('"ok": true'); await rendered('"found": true');
        } else if (mode === 'oversized') {
          assert.ok(finalEnd.result.value.length > 300 * 1024);
          await rendered('Payload omitted: native retention limit is 262144 bytes');
          assert.equal(screen().includes('PRIVATE_INSPECTION_BODY_'), false);
        } else {
          assert.equal(finalEnd.result, null);
          await rendered(`No complete payload admitted (capture ${expected})`);
        }
        terminal.write('3'); await rendered('current disk availability is unverified');
        const inventory = (await events()).find(event => event.event === 'job:artifacts');
        if (['text', 'disabled'].includes(mode)) {
          assert.equal(inventory.artifacts.length, 2);
          assert.ok(inventory.artifacts.every(artifact => artifact.exists === true));
          await rendered('search metrics dir'); await rendered('Recorded exists=true');
          await rendered(metrics);
        } else assert.deepEqual(inventory.artifacts, []);
        terminal.write('\x1b');
        await wait(() => !screen().includes('┌Job inspection'), 'inspector closed before quit');
        terminal.write('q');
      } finally {
        subscription.dispose(); await fs.writeFile(path.join(dir, 'terminal-output.ansi.log'), output);
      }
    } });
  assert.equal(capture.timedOut, false, capture.outputDir); assert.equal(capture.exitCode, 0, capture.outputDir);
  const receipt = JSON.parse(await fs.readFile(path.join(dir, 'terminal-receipt.json'), 'utf8'));
  assert.equal(receipt.exitCode, 0, receipt.stderr); assert.equal(receipt.stderr, '');
  assert.equal(receipt.terminalRestored, true);
  const witnesses = await readLines('pids.jsonl');
  const owned = [...new Set(witnesses.flatMap(row => ['native', 'proxy', 'supervisor', 'job'].map(key => row[key]).filter(Number.isInteger)))];
  assert.equal(owned.length, 4); assert.deepEqual(owned.filter(isProcessAlive), []);
  const snapshotText = await fs.readFile(path.join(dir, 'state.json'), 'utf8');
  assert.equal(snapshotText.includes('PRIVATE_INSPECTION_BODY_'), false);
  const runtimeText = await fs.readFile(path.join(dir, 'inspection-native.runtime.jsonl'), 'utf8');
  assert.equal(runtimeText.includes('PRIVATE_INSPECTION_BODY_'), false);
  assert.deepEqual(JSON.parse(snapshotText).final_job_statuses, { 'job-1': mode === 'incomplete' ? 'cancelled' : 'done' });
  const warnings = (await events()).filter(event => event.event === 'log' && event.level === 'warn');
  if (mode === 'truncated') {
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].message, 'stdout decoder overflow (1932 bytes truncated).');
    assert.equal(warnings[0].stream, 'stdout');
  } else assert.deepEqual(warnings, []);
  console.log(JSON.stringify({ mode, binary, binarySha256, node: process.version, abi: process.versions.modules,
    platform: process.platform, receipt, owned, status: finalEnd.status, resultState: finalEnd.resultState,
    capture: capture.outputDir }));
} finally {
  for (const row of await readLines('pids.jsonl')) if (row.proxy && isProcessAlive(row.proxy)) await killProcessTree(row.proxy);
}
