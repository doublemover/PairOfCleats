import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';
import { prepareIsolatedTestCacheDir } from './test-cache.js';
import { reconstructTerminalScreen } from '../../tools/testing/terminal-screen.js';

export const verifyNativeTuiConpty = async (mode, { binaryPath = null } = {}) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  assert.ok(binaryPath == null || path.isAbsolute(binaryPath), 'Native qualification selects an absolute binary path');
  const binary = binaryPath || path.join(root, 'crates/pairofcleats-tui/target/debug/pairofcleats-tui.exe');
  await fs.access(binary);
  const binarySha256 = createHash('sha256').update(await fs.readFile(binary)).digest('hex');
  const { dir } = await prepareIsolatedTestCacheDir(`native-conpty-${mode}`, { root, clean: true });
  const pidFile = path.join(dir, 'pids.jsonl');
  await fs.writeFile(path.join(dir, 'fixture-mode.json'), JSON.stringify(mode));
  const readPids = async () => {
    try { return (await fs.readFile(pidFile, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  try {
    const capture = await captureCommandTerminalRun({
      command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        path.join(root, 'tests/fixtures/tui/native-lifetime-conpty.ps1'), binary, dir, mode],
      rootDir: root, cwd: root, cols: 140, rows: 40, label: `native-${mode}`,
      logsRoot: path.join(dir, 'capture'), timeoutMs: 26000,
      env: { ...process.env, PAIROFCLEATS_TUI_NODE: process.execPath,
        PAIROFCLEATS_TUI_SUPERVISOR: path.join(root, 'tests/fixtures/tui/native-lifetime-supervisor.js'),
        PAIROFCLEATS_TUI_SNAPSHOT_PATH: path.join(dir, 'state.json'), PAIROFCLEATS_TUI_EVENT_LOG_DIR: dir },
      onSpawn: async terminal => {
        let sentRun = false;
        const until = Date.now() + 16000;
        for (;;) {
          const rows = await readPids();
          if (!sentRun && rows.some(row => row.nativeReady)) { terminal.write('r'); sentRun = true; }
          if (rows.some(row => row.descendant)) {
            if (['quit', 'shutdown-error', 'shutdown-timeout', 'shutdown-partial-frame'].includes(mode)) terminal.write('q');
            if (mode === 'interrupt') {
              let overlayOutput = '';
              const subscription = terminal.onData(data => { overlayOutput = (overlayOutput + data).slice(-32768); });
              try {
                terminal.write('/');
                const overlayDeadline = Date.now() + 2000;
                const screen = () => reconstructTerminalScreen(overlayOutput, { columns: 140, rows: 40 }).text;
                while (!screen().includes('Type to filter') && Date.now() < overlayDeadline) {
                  await new Promise(resolve => setTimeout(resolve, 20));
                }
                await fs.writeFile(path.join(dir, 'search-overlay.ansi.log'), overlayOutput);
                await fs.writeFile(path.join(dir, 'search-overlay-screen.txt'), screen());
                assert.ok(screen().includes('Type to filter'), 'The real search overlay must render before Ctrl+C');
                terminal.write('\x03\x03');
              } finally { subscription.dispose(); }
            }
            if (mode === 'terminal-error') await fs.writeFile(path.join(dir, 'break-output'), 'close output');
            return;
          }
          if (Date.now() > until) throw Error('ConPTY did not start the owned descendant fixture');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
    });
    assert.equal(capture.timedOut, false, `ConPTY lifetime exceeded deadline: ${capture.outputDir}`);
    assert.equal(capture.exitCode, 0, `ConPTY launcher failed: ${capture.outputDir}`);
    const receipt = JSON.parse(await fs.readFile(path.join(dir, 'terminal-receipt.json'), 'utf8'));
    assert.equal(receipt.mode, mode);
    assert.equal(receipt.terminalRestored, true, JSON.stringify(receipt));
    if (mode === 'quit' || mode === 'interrupt') {
      assert.equal(receipt.exitCode, 0, receipt.stderr);
      assert.equal(receipt.stderr, '', 'clean shutdown must not emit warnings or errors');
    }
    if (mode === 'supervisor-error') {
      assert.notEqual(receipt.exitCode, 0, 'unexpected supervisor failure must propagate to the native exit status');
      assert.match(receipt.stderr, /supervisor exited before TUI shutdown/);
    }
    if (mode === 'shutdown-error') {
      assert.notEqual(receipt.exitCode, 0, 'a real nonzero owned supervisor exit during quit must reach the native status');
      assert.match(receipt.stderr, /supervisor exited unsuccessfully during shutdown/);
    }
    if (mode === 'shutdown-timeout') {
      assert.notEqual(receipt.exitCode, 0, 'forced containment cannot become successful graceful shutdown');
      assert.match(receipt.stderr, /graceful shutdown deadline; containment was required/);
    }
    if (mode === 'shutdown-partial-frame') {
      assert.notEqual(receipt.exitCode, 0, 'a lost final frame cannot become clean output EOF during quit');
      assert.match(receipt.stderr, /Supervisor output transport failed during shutdown \(UnexpectedEof\)/);
    }
    if (mode === 'terminal-error') {
      assert.notEqual(receipt.exitCode, 0, 'broken output must exercise native error return');
      assert.match(receipt.stderr, /os error (109|232)/, 'the deliberately closed pipe owns the expected diagnostic');
    }
    if (mode === 'event-transport-error') {
      assert.notEqual(receipt.exitCode, 0, 'event EOF while the owned supervisor is alive must propagate native failure');
      assert.match(receipt.stderr, /supervisor event transport closed while the owned child remained active/);
    }
    const rows = await readPids();
    if (mode === 'interrupt' || mode === 'event-transport-error') {
      assert.equal(rows.filter(row => row.request === 'eof').length, 1, 'Ctrl+C uses the existing single graceful supervisor EOF');
      assert.equal(rows.filter(row => row.request === 'job:cancel').length, 0, 'Ctrl+C cannot submit selected-job cancellation');
    }
    const pids = [...new Set(rows.flatMap(row => ['native', 'proxy', 'supervisor', 'job', 'descendant']
      .map(key => row[key]).filter(Number.isInteger)))];
    assert.ok(pids.length >= 5, 'witness native, proxy, supervisor, job and detached descendant');
    const until = Date.now() + 2000;
    while (pids.some(isProcessAlive) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(pids.filter(isProcessAlive), [], 'every owned process must be reaped');
    const snapshot = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8'));
    const statuses = Object.values(snapshot.final_job_statuses);
    assert.ok(statuses.length && statuses.every(status => ['cancelled', 'failed', 'done', 'interrupted'].includes(status)));
    if (!['supervisor-error', 'event-transport-error', 'shutdown-timeout'].includes(mode)) assert.deepEqual(statuses, ['cancelled']);
    else assert.deepEqual(statuses, ['interrupted'], 'loss of producer terminal evidence must be explicit');
    const summary = { ...receipt, binary, binarySha256, ownedPids: pids, finalStatuses: statuses,
      allReaped: true, capture: capture.outputDir };
    console.log(`Native ConPTY lifetime passed: ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    for (const row of await readPids()) {
      for (const key of ['native', 'proxy', 'supervisor', 'job', 'descendant']) {
        if (Number.isInteger(row[key]) && isProcessAlive(row[key])) await killProcessTree(row[key]);
      }
    }
  }
};
