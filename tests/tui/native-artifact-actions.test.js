import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { reconstructTerminalScreen } from '../../tools/testing/terminal-screen.js';
import { getRepoCacheRoot, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { normalizeEnvPathKeys } from '../../src/shared/env-path.js';
import { resolveTrustedTuiCommand } from '../../tools/tui/operator/command.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { initGitRepo } from '../helpers/git-fixture.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tui/native-artifact-actions/')[1];
assert.ok(['actions', 'stale', 'missing', 'untrusted', 'cancel'].includes(mode));
const root = process.cwd(), { dir } = await prepareIsolatedTestCacheDir(`native-artifacts-${mode}`);
const repo = path.join(dir, 'selected repository'), bin = path.join(repo, 'commands');
await fs.mkdir(bin, { recursive: true }); initGitRepo(repo);
const source = path.join(repo, '.pairofcleats.json'), body = Buffer.from('{"threads":1}\n');
await fs.writeFile(source, body);
await fs.writeFile(path.join(dir, 'artifact-mode.json'), JSON.stringify({ mode, repo }));
await fs.copyFile(path.join(root, 'tests/fixtures/tui/operator-artifact-command.js'), path.join(bin, 'command.mjs'));
const clipboard = process.platform === 'win32' ? 'powershell' : process.platform === 'darwin' ? 'pbcopy' : 'wl-copy';
for (const [name, kind] of [['code', 'editor'], [clipboard, 'clipboard']]) {
  await fs.writeFile(path.join(bin, name + (process.platform === 'win32' ? '.cmd' : '')),
    process.platform === 'win32'
      ? `@"${process.execPath}" "${path.join(bin, 'command.mjs')}" ${kind} %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${path.join(bin, 'command.mjs')}' ${kind} "$@"\n`, { mode: 0o700 });
}
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', extraEnv: {
  PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify(mode === 'untrusted' ? [] : [repo]),
  PAIROFCLEATS_TUI_NODE: process.execPath,
  PAIROFCLEATS_TUI_SUPERVISOR: path.join(root, 'tests/fixtures/tui/native-artifact-supervisor.js'),
  PAIROFCLEATS_TUI_WORKSPACE_ROOT: repo, PAIROFCLEATS_TUI_RUN_ID: 'artifact-native',
  PAIROFCLEATS_TUI_EVENT_LOG_DIR: dir, PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(dir, 'state.json')
} });
const normalizedPath = normalizeEnvPathKeys(env);
env[normalizedPath.key] = bin + path.delimiter + normalizedPath.value;
for (const name of ['code', clipboard]) {
  const selected = await resolveTrustedTuiCommand({ names: [name], repoRoot: repo, toolRoot: root,
    env: { ...env, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]) }, prefix: 'FIXTURE_COMMAND' });
  assert.equal(selected.path, path.join(bin, name + (process.platform === 'win32' ? '.cmd' : '')));
}
await fs.mkdir(getRepoCacheRoot(repo, loadUserConfig(repo)), { recursive: true });
const binary = path.join(root, 'crates/pairofcleats-tui/target/debug',
  process.platform === 'win32' ? 'pairofcleats-tui.exe' : 'pairofcleats-tui');
const binarySha256 = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
const lines = async (base, name) => {
  try { const text = await fs.readFile(path.join(base, name), 'utf8');
    return text.slice(0, text.lastIndexOf('\n') + 1).split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const events = () => lines(dir, 'artifact-native.jsonl'), calls = () => lines(bin, 'calls.jsonl');
const columns = 220, rows = 44;
try {
  const launcher = process.platform === 'win32'
    ? { command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'), binary, dir, mode] }
    : { command: 'python3', args: [path.join(root, 'tests/fixtures/tui/native-terminal.py'), binary, dir, mode] };
  const capture = await captureCommandTerminalRun({ ...launcher, rootDir: root, cwd: root, cols: columns, rows,
    label: `native-artifact-${mode}`, logsRoot: path.join(dir, 'capture'), timeoutMs: 22000, env,
    onSpawn: async terminal => {
      let output = '', tail = '', frame = 0;
      const subscription = terminal.onData(data => {
        output = (output + data).slice(-1024 * 1024);
        if (process.platform !== 'win32') {
          const wire = tail + data;
          for (let count = wire.split('\x1b[6n').length - 1; count > 0; count--) terminal.write('\x1b[1;1R');
          tail = wire.slice(-3);
        }
      });
      const deadline = Date.now() + 14000;
      const wait = async (predicate, label) => {
        while (!await predicate()) { assert.ok(Date.now() < deadline, `Native artifact witness timed out: ${label}`);
          await new Promise(resolve => setTimeout(resolve, 20)); }
      };
      const screen = () => reconstructTerminalScreen(output, { columns, rows }).text;
      const rendered = async label => { await wait(() => screen().includes(label), label);
        await fs.writeFile(path.join(dir, `screen-${frame++}.txt`), screen()); };
      try {
        await rendered('Tab focus'); terminal.write('r');
        await wait(async () => (await events()).some(event => event.event === 'job:artifacts'), 'real inventory');
        const inventory = (await events()).find(event => event.event === 'job:artifacts');
        assert.match(inventory.inventoryId, /^[a-f0-9-]{36}$/);
        assert.equal(inventory.jobId, 'job-1');
        const index = inventory.artifacts.findIndex(row => row.kind === 'config:file');
        assert.ok(index >= 0); assert.equal(inventory.artifacts[index].snapshotVerified, true);
        terminal.write('v'); await rendered('Process status: done'); terminal.write('3');
        await rendered('current disk availability is unverified');
        terminal.write('j'.repeat(index)); await rendered('> config file');
        if (mode === 'stale') {
          await fs.rename(source, path.join(repo, 'retired.json')); await fs.writeFile(source, body);
        } else if (mode === 'missing') await fs.unlink(source);
        else if (mode === 'cancel') await fs.writeFile(path.join(bin, 'block'), 'explicit fixture hang');
        terminal.write('o'); await rendered('Open the verified artifact in VS Code?');
        terminal.write('\x1b'); await rendered('Artifact action cancelled before execution');
        assert.deepEqual(await calls(), []);
        terminal.write('o'); await rendered('Open the verified artifact in VS Code?'); terminal.write('\r');
        if (mode === 'cancel') {
          await wait(async () => (await calls()).length === 1, 'actual launcher running'); terminal.write('\x1b');
          await rendered('Artifact open cancelled: ABORT_ERR');
        } else if (mode === 'actions') {
          await rendered('Artifact open complete');
          assert.deepEqual((await calls())[0].args, ['--reuse-window', source]);
          terminal.write('y'); await rendered('Artifact copy complete'); assert.equal((await calls())[1].input, source);
          terminal.write('e'); await rendered('Export new file within the selected repository:');
          terminal.write('exported.json\r'); await rendered('Artifact export complete');
          assert.deepEqual(await fs.readFile(path.join(repo, 'exported.json')), body);
          terminal.write('e'); await rendered('Export new file within the selected repository:');
          terminal.write('exported.json\r'); await rendered('Artifact export failed: ERR_TUI_ARTIFACT_DESTINATION_EXISTS');
          assert.deepEqual(await fs.readFile(path.join(repo, 'exported.json')), body);
          terminal.write('e'); await rendered('Export new file within the selected repository:');
          terminal.write('../escape.json\r'); await rendered('Artifact export failed: ERR_UNSAFE_FILE_PATH');
          await assert.rejects(fs.stat(path.join(dir, 'escape.json')), { code: 'ENOENT' });
        } else {
          await rendered(`Artifact open failed: ${mode === 'stale' ? 'ERR_FILE_CHANGED'
            : mode === 'missing' ? 'ENOENT' : 'ERR_TUI_EDITOR_UNTRUSTED'}`);
          assert.deepEqual(await calls(), []);
        }
        assert.ok(screen().includes('Job job-1'), 'internal operations never retarget the selected job');
        const requests = (await lines(dir, 'pids.jsonl')).filter(row => row.request?.op === 'artifact:run').map(row => row.request);
        assert.ok(requests.length > 0);
        assert.ok(requests.every(request => request.params.sourceJobId === 'job-1'
          && request.params.inventoryId === inventory.inventoryId
          && request.params.artifactId === inventory.artifacts[index].artifactId));
        terminal.write('\x1b'); await wait(() => !screen().includes('┌Job inspection'), 'inspector closed'); terminal.write('q');
      } finally { subscription.dispose(); await fs.writeFile(path.join(dir, 'terminal-output.ansi.log'), output); }
    } });
  assert.equal(capture.timedOut, false); assert.equal(capture.exitCode, 0, capture.outputDir);
  const receipt = JSON.parse(await fs.readFile(path.join(dir, 'terminal-receipt.json'), 'utf8'));
  assert.equal(receipt.exitCode, 0); assert.equal(receipt.stderr, ''); assert.equal(receipt.terminalRestored, true);
  const owned = [...new Set((await lines(dir, 'pids.jsonl')).flatMap(row =>
    ['native', 'proxy', 'supervisor', 'job'].map(key => row[key]).filter(Number.isInteger)))];
  assert.ok(owned.length >= 4); assert.deepEqual(owned.filter(isProcessAlive), []);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8')).final_job_statuses, { 'job-1': 'done' });
  assert.deepEqual((await events()).filter(event => event.event === 'log' && ['warn', 'error'].includes(event.level)), []);
  console.log(JSON.stringify({ mode, binarySha256, node: process.version, platform: process.platform, owned, receipt, capture: capture.outputDir }));
} finally {
  for (const row of await lines(dir, 'pids.jsonl')) if (row.proxy && isProcessAlive(row.proxy)) await killProcessTree(row.proxy);
}
