import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';
import { readBuildManifestSync, resolveHostTargetTriple, resolveTargetForTriple } from '../../tools/tui/targets.js';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../helpers/test-env.js';

assert.equal(process.platform, 'win32', 'This fixture qualifies actual Windows ConPTY and executable sharing.');
const root = process.cwd(), triple = resolveHostTargetTriple();
const qualificationArgs = process.argv.slice(2);
assert.ok(qualificationArgs.length === 0 || qualificationArgs.length === 2 && qualificationArgs[0] === '--dist-dir',
  'Native qualification accepts only an explicit staged distribution directory.');
const distDirectory = qualificationArgs[1] ? path.resolve(qualificationArgs[1]) : null;
const staged = await withTemporaryEnv(distDirectory ? { PAIROFCLEATS_TUI_DIST_DIR: distDirectory } : {},
  () => resolveTargetForTriple(readBuildManifestSync({ root, verifyChecksum: true }).artifacts, triple));
assert.ok(staged?.exists && staged.sha256, 'Build the exact Windows TUI artifact before native installation qualification.');
const { dir } = await prepareIsolatedTestCacheDir('native-install-generation-conpty');
const installRoot = path.join(dir, 'install'), logs = path.join(dir, 'events'), repo = path.join(dir, 'repo');
await fs.mkdir(repo);
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: false,
  extraEnv: { PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null,
    PAIROFCLEATS_TUI_DIST_DIR: distDirectory,
    PAIROFCLEATS_TUI_INSTALL_ROOT: installRoot, PAIROFCLEATS_TUI_EVENT_LOG_DIR: logs,
    PAIROFCLEATS_TUI_RUN_ID: 'native-install-upgrade', PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(dir, 'state.json') } });
const run = (args, extra = {}) => spawnSubprocess(process.execPath, args, { cwd: root, env, stdio: 'pipe',
  rejectOnNonZeroExit: false, maxOutputBytes: 65536, timeoutMs: 10000, ...extra });
const install = () => run(['tools/tui/install.js', '--target', triple, '--install-root', installRoot, '--build=false', '--json']);
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const wait = async (predicate, label, deadline = Date.now() + 6000) => {
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, `${label} exceeded its bounded deadline`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
const secondSession = path.join(dir, 'new-generation-session');
const readPids = async (directory = dir) => {
  try { return (await fs.readFile(path.join(directory, 'pids.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map(row => JSON.parse(row)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const readEvents = async () => {
  try { const text = await fs.readFile(path.join(logs, 'native-install-upgrade.jsonl'), 'utf8');
    return text.slice(0, text.lastIndexOf('\n')).split(/\r?\n/).filter(Boolean).map(row => JSON.parse(row)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
let holder = null, capture, first, second, newCapture;
try {
  const initial = await install(); assert.equal(initial.exitCode, 0, initial.stderr); assert.equal(initial.stderr, '');
  first = JSON.parse(initial.stdout);
  const metadataPath = path.resolve(root, first.metadata), binaryA = path.resolve(root, first.installedTo);
  const originalMetadata = await fs.readFile(metadataPath, 'utf8'), binaryBytes = await fs.readFile(binaryA);
  assert.equal(createHash('sha256').update(binaryBytes).digest('hex'), staged.sha256);
  capture = await captureCommandTerminalRun({ command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'), process.execPath, dir, 'install-upgrade',
    path.join(root, 'bin/pairofcleats-tui.js')], cwd: repo, rootDir: root, env, cols: 140, rows: 40,
  logsRoot: path.join(dir, 'capture'), label: 'native-install-upgrade', timeoutMs: 26000,
  onSpawn: async terminal => {
    try {
      await wait(async () => (await readEvents()).some(row => row.event === 'hello'), 'production supervisor hello');
      await wait(async () => (await readPids()).some(row => row.supervisor), 'original wrapper/native/supervisor ownership');
      const live = (await readPids()).flatMap(row => [row.wrapper, row.native, row.supervisor]).filter(Number.isInteger);
      assert.equal(live.length, 3); assert.ok(live.every(isProcessAlive));
      assert.equal(path.resolve((await readPids()).find(row => row.native).executablePath).toLowerCase(), binaryA.toLowerCase());
      holder = spawnSubprocess('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        path.join(root, 'tests/fixtures/tui/hold-install-metadata.ps1'), metadataPath, dir],
      { cwd: repo, env, stdio: 'pipe', rejectOnNonZeroExit: false, timeoutMs: 14000, maxOutputBytes: 16384 });
      holder.catch(() => {});
      await wait(async () => { try { await fs.stat(path.join(dir, 'metadata-held')); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }, 'actual Windows metadata share lock');
      const denied = await install();
      assert.notEqual(denied.exitCode, 0, 'Windows sharing refusal cannot be reported as installed');
      assert.match(denied.stderr, /previous generation is retained|Close a process holding the install manifest/);
      assert.equal(await fs.readFile(metadataPath, 'utf8'), originalMetadata);
      assert.ok(live.every(isProcessAlive));
      await fs.writeFile(path.join(dir, 'release-metadata'), 'release');
      const closed = await holder; holder = null; assert.equal(closed.exitCode, 0, closed.stderr);
      const upgraded = await install(); assert.equal(upgraded.exitCode, 0, upgraded.stderr); assert.equal(upgraded.stderr, '');
      second = JSON.parse(upgraded.stdout);
      assert.notEqual(second.transaction.generationId, first.transaction.generationId);
      assert.equal(second.transaction.state, 'published');
      assert.equal((await readJson(metadataPath)).generationId, second.transaction.generationId);
      assert.ok(live.every(isProcessAlive), 'publishing B preserves the actual executing A generation');
      assert.deepEqual(await fs.readFile(binaryA), binaryBytes);
      await fs.mkdir(secondSession);
      const newLogs = path.join(secondSession, 'events');
      newCapture = await captureCommandTerminalRun({ command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'), process.execPath, secondSession, 'install-new-generation',
        path.join(root, 'bin/pairofcleats-tui.js')], cwd: repo, rootDir: root, env: { ...env,
        PAIROFCLEATS_TUI_EVENT_LOG_DIR: newLogs, PAIROFCLEATS_TUI_RUN_ID: 'native-install-new',
        PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(secondSession, 'state.json') }, cols: 140, rows: 40,
      logsRoot: path.join(secondSession, 'capture'), label: 'native-install-new', timeoutMs: 8000,
      onSpawn: async current => {
        try {
          await wait(async () => {
            try { return (await fs.readFile(path.join(newLogs, 'native-install-new.jsonl'), 'utf8')).includes('"event":"hello"'); }
            catch (error) { if (error.code === 'ENOENT') return false; throw error; }
          }, 'new production supervisor hello');
          await wait(async () => (await readPids(secondSession)).some(row => row.supervisor), 'new generation process ownership');
          const native = (await readPids(secondSession)).find(row => row.native);
          assert.equal(path.resolve(native.executablePath).toLowerCase(), path.resolve(root, second.installedTo).toLowerCase());
          assert.ok(live.every(isProcessAlive), 'A remains active while the newly selected B executes');
        } finally { current.write('q'); }
      } });
      const newTerminal = await readJson(path.join(secondSession, 'terminal-receipt.json'));
      assert.equal(newCapture.status, 'passed'); assert.equal(newTerminal.exitCode, 0);
      assert.equal(newTerminal.terminalRestored, true); assert.equal(newTerminal.stderr, '');
      await fs.writeFile(path.join(dir, 'upgrade-receipt.json'), JSON.stringify({ first, second, denied: { exitCode: denied.exitCode, stderr: denied.stderr },
        liveOriginalPids: live, newCapture: newCapture.outputDir, artifactSha256: staged.sha256 }, null, 2));
    } finally {
      await fs.writeFile(path.join(dir, 'release-metadata'), 'release');
      terminal.write('q');
    }
  } });
  assert.equal(capture.exitCode, 0); assert.equal(capture.status, 'passed');
  const terminalReceipt = await readJson(path.join(dir, 'terminal-receipt.json'));
  assert.equal(terminalReceipt.exitCode, 0); assert.equal(terminalReceipt.terminalRestored, true); assert.equal(terminalReceipt.stderr, '');
  const pids = [...await readPids(), ...await readPids(secondSession)].flatMap(row => [row.wrapper, row.native, row.supervisor]).filter(Number.isInteger);
  await wait(() => pids.every(pid => !isProcessAlive(pid)), 'original process reaping', Date.now() + 2000);
  const state = await readJson(path.join(dir, 'state.json'));
  const newState = await readJson(path.join(secondSession, 'state.json'));
  for (const snapshot of [state, newState]) {
    assert.ok(snapshot.final_job_statuses && typeof snapshot.final_job_statuses === 'object' && !Array.isArray(snapshot.final_job_statuses));
    assert.ok(Object.values(snapshot.final_job_statuses).every(status => ['done', 'failed', 'cancelled', 'interrupted'].includes(status)));
  }
  console.log(`Native Windows install upgrade passed: ${JSON.stringify({ artifactSha256: staged.sha256, first: first.transaction.generationId,
    second: second.transaction.generationId, terminalRestored: true, allReaped: true, capture: capture.outputDir, receipt: path.join(dir, 'upgrade-receipt.json') })}`);
} finally {
  await fs.writeFile(path.join(dir, 'release-metadata'), 'release');
  if (holder) await holder.catch(() => {});
  for (const row of [...await readPids(), ...await readPids(secondSession)]) for (const pid of [row.wrapper, row.native, row.supervisor].filter(Number.isInteger)) {
    if (isProcessAlive(pid)) await killProcessTree(pid, { graceMs: 0, killTree: true });
  }
}
