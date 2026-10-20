import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { reconstructTerminalScreen } from '../../tools/testing/terminal-screen.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';
import { parseJsoncText } from '../../src/shared/jsonc.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';

assert.equal(process.platform, 'win32', 'This owner qualifies actual Windows ConPTY; other platforms require their native PTY owner');
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tui/native-settings-conpty/')[1];
assert.ok(['edit', 'stale', 'reset', 'workspace'].includes(mode));
const root = process.cwd();
const binary = path.join(root, 'crates/pairofcleats-tui/target/debug/pairofcleats-tui.exe');
const binarySha256 = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
const { dir } = await prepareIsolatedTestCacheDir(`native-settings-${mode}`);
const repo = path.join(dir, 'selected repository'), other = path.join(dir, 'another repository');
await fs.mkdir(repo); await fs.mkdir(other); initGitRepo(repo); initGitRepo(other);
const file = path.join(repo, '.pairofcleats.json');
const privateValue = 'native-settings-private-provider-credential';
const original = JSON.stringify({ threads: 2, quality: 'fast', tooling: { lsp: { servers: [
  { id: 'private-fixture', cmd: 'never-run', args: [`-Djavax.net.ssl.keyStorePassword=${privateValue}`] }
] } } });
await fs.writeFile(file, original);
await fs.writeFile(path.join(other, '.pairofcleats.json'), '{"threads":3}');
const workspace = path.join(repo, 'workspace.jsonc');
await fs.writeFile(workspace, JSON.stringify({ schemaVersion: 1, name: 'native settings workspace',
  repos: [{ root: repo }, { root: other }] }));
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  syncProcess: false, extraEnv: { PAIROFCLEATS_TUI_NODE: process.execPath,
    PAIROFCLEATS_TUI_SUPERVISOR: path.join(root, 'tools/tui/supervisor.js'),
    PAIROFCLEATS_TUI_RUN_ID: 'settings-native', PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(dir, 'state.json'),
    PAIROFCLEATS_TUI_EVENT_LOG_DIR: dir } });
const readEvents = async () => {
  let text;
  try { text = await fs.readFile(path.join(dir, 'settings-native.jsonl'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const rows = text.slice(0, text.lastIndexOf('\n')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const chunks = new Map();
  for (const row of [...rows]) {
    if (row.event !== 'event:chunk') continue;
    const parts = chunks.get(row.chunkId) || new Map();
    parts.set(row.chunkIndex, row.chunk); chunks.set(row.chunkId, parts);
    if (parts.size === row.chunkCount) {
      rows.push(JSON.parse(Array.from({ length: row.chunkCount }, (_, i) => parts.get(i)).join('')));
      chunks.delete(row.chunkId);
    }
  }
  return rows;
};
try {
  const capture = await captureCommandTerminalRun({ command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile',
    '-NonInteractive', '-File', path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'), binary, dir, 'settings'],
  rootDir: root, cwd: root, cols: 170, rows: 46, label: `native-settings-${mode}`,
  logsRoot: path.join(dir, 'capture'), timeoutMs: 26000, env,
  onSpawn: async terminal => {
    let output = '';
    const subscription = terminal.onData(data => { output = (output + data).slice(-1024 * 1024); });
    const deadline = Date.now() + 22000;
    const wait = async (predicate, witness) => {
      while (!await predicate()) {
        assert.ok(Date.now() < deadline, `native settings witness timed out: ${witness}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    const screen = () => reconstructTerminalScreen(output, { columns: 170, rows: 46 }).text;
    const rendered = async witness => {
      await wait(() => screen().includes(witness), witness);
      await fs.writeFile(path.join(dir, `screen-${screens++}.txt`), screen());
    };
    let screens = 0;
    const settled = async (method, after) => {
      let end;
      await wait(async () => {
        const rows = await readEvents();
        end = rows.find(row => row.event === 'job:end' && row.result?.method === method && Number(row.jobId.split('-').at(-1)) > after);
        return end;
      }, `${method} response after ${after}`);
      return end;
    };
    const lastJob = async () => Math.max(0, ...(await readEvents()).filter(row => row.internal && row.event === 'job:start')
      .map(row => Number(row.jobId.split('-').at(-1))));
    const select = async (target, toggle = false) => {
      const after = await lastJob();
      if (toggle) terminal.write('\t');
      terminal.write(`\x15${target}\r`);
      const result = await settled('inspect', after);
      assert.equal(result.result.data.validation.ok, true);
      await rendered('Loaded canonical configuration preview');
      return result.result.data;
    };
    const preview = async () => {
      terminal.write('\r'); await rendered('Edit threads as JSON');
      terminal.write('\x151\r'); await rendered('Validated preview; no file has been changed');
    };
    try {
      await wait(async () => (await readEvents()).some(row => row.event === 'hello'), 'real supervisor hello');
      terminal.write('s'); await rendered('Select repository directory');
      const info = await select(mode === 'workspace' ? workspace : repo, mode === 'workspace');
      assert.equal(info.effective.userConfig.threads, 2);
      if (mode === 'workspace') {
        assert.equal(info.scope.kind, 'workspace'); assert.equal(info.scope.repoCount, 2);
        terminal.write('s'); await rendered('Select workspace file');
        const next = await select(other, true);
        assert.equal(next.scope.kind, 'repo'); assert.notEqual(next.scope.id, info.scope.id);
        assert.equal(next.effective.userConfig.threads, 3);
      } else if (mode === 'reset') {
        terminal.write('R'); await rendered('RESET preview');
        const after = await lastJob();
        terminal.write('\r'); await rendered('Reset requires typing RESET exactly');
        assert.equal(await lastJob(), after, 'no commit request before explicit reset confirmation');
        assert.equal(await fs.readFile(file, 'utf8'), original);
        terminal.write('RESET\r');
        await settled('commit', after); await settled('inspect', after);
        await rendered('Loaded canonical configuration preview');
        assert.notEqual(await fs.readFile(file, 'utf8'), original);
        const rows = await readEvents();
        const saved = rows.find(row => row.result?.method === 'commit').result.data;
        assert.equal(saved.reset, true);
        assert.equal(await fs.readFile(saved.backupPath, 'utf8'), original);
      } else {
        terminal.write('/threads\r'); await rendered('Selected: threads');
        if (mode === 'edit') {
          terminal.write('\r'); await rendered('Edit threads as JSON');
          terminal.write('\x15"invalid"\r'); await rendered('Invalid value; nothing saved');
          assert.equal(await fs.readFile(file, 'utf8'), original);
          await preview(); terminal.write('\x1b'); await rendered('Preview cancelled; nothing saved');
          assert.equal(await fs.readFile(file, 'utf8'), original);
          await preview();
          const after = await lastJob(); terminal.write('\r');
          await settled('commit', after);
          const next = await settled('inspect', after);
          assert.equal(next.result.data.effective.userConfig.threads, 1,
            'actual keyboard save changes the next canonical CLI invocation');
          await rendered('Effective: 1');
          assert.ok((await fs.readFile(file, 'utf8')).includes(privateValue));
        } else {
          await preview();
          await fs.writeFile(file, '{"threads":3}');
          terminal.write('\r'); await rendered('ERR_TUI_SETTINGS_STALE');
          assert.equal(await fs.readFile(file, 'utf8'), '{"threads":3}', 'stale UI save cannot overwrite a concurrent edit');
          const after = await lastJob(); terminal.write('r');
          const next = await settled('inspect', after);
          assert.equal(next.result.data.effective.userConfig.threads, 3);
          await rendered('Effective: 3');
        }
      }
      terminal.write('\x1b'); await rendered('Tab focus'); terminal.write('q');
    } finally {
      subscription.dispose();
      await fs.writeFile(path.join(dir, 'terminal-output.ansi.log'), output);
    }
  } });
  assert.equal(capture.timedOut, false, capture.outputDir);
  assert.equal(capture.exitCode, 0, capture.outputDir);
  const receipt = JSON.parse(await fs.readFile(path.join(dir, 'terminal-receipt.json'), 'utf8'));
  assert.equal(receipt.exitCode, 0, receipt.stderr); assert.equal(receipt.stderr, '');
  assert.equal(receipt.terminalRestored, true);
  const snapshotText = await fs.readFile(path.join(dir, 'state.json'), 'utf8');
  const snapshot = JSON.parse(snapshotText);
  assert.deepEqual(snapshot.final_job_statuses, {}, 'control requests never steal foreground job selection');
  assert.equal(snapshot.selected_job, null);
  const runtimeTelemetry = await fs.readFile(path.join(dir, 'settings-native.runtime.jsonl'), 'utf8');
  const terminalOutput = await fs.readFile(path.join(dir, 'terminal-output.ansi.log'), 'utf8');
  assert.equal((snapshotText + runtimeTelemetry + terminalOutput + JSON.stringify(await readEvents())).includes(privateValue), false);
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'settings-native.meta.json'), 'utf8'));
  assert.ok(meta.endedAt); assert.equal(isProcessAlive(meta.pid), false);
  console.log(JSON.stringify({ mode, binary, binarySha256, receipt, supervisorReaped: true, capture: capture.outputDir }));
} finally {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'settings-native.meta.json'), 'utf8'));
    if (isProcessAlive(meta.pid)) await killProcessTree(meta.pid);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
