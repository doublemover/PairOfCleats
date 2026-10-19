import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCommandTerminalRun } from '../../tools/testing/search-debug-capture.js';
import { isProcessAlive } from '../../src/shared/locks/file-lock-owner.js';
import { killProcessTree } from '../../src/shared/kill-tree.js';
import { prepareIsolatedTestCacheDir } from './test-cache.js';

export const verifyNativeTuiConpty = async mode => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const binary = path.join(root, 'crates/pairofcleats-tui/target/debug/pairofcleats-tui.exe');
  await fs.access(binary);
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
          if (!sentRun && rows.some(row => row.supervisor)) { terminal.write('r'); sentRun = true; }
          if (rows.some(row => row.descendant)) {
            if (mode === 'quit') terminal.write('q');
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
    if (mode === 'quit') assert.equal(receipt.exitCode, 0, receipt.stderr);
    if (mode === 'quit') assert.equal(receipt.stderr, '', 'clean quit must not emit warnings or errors');
    if (mode === 'supervisor-error') {
      assert.notEqual(receipt.exitCode, 0, 'unexpected supervisor failure must propagate to the native exit status');
      assert.match(receipt.stderr, /supervisor exited before TUI shutdown/);
    }
    if (mode === 'terminal-error') {
      assert.notEqual(receipt.exitCode, 0, 'broken output must exercise native error return');
      assert.match(receipt.stderr, /os error (109|232)/, 'the deliberately closed pipe owns the expected diagnostic');
    }
    const rows = await readPids();
    const pids = [...new Set(rows.flatMap(row => ['native', 'proxy', 'supervisor', 'job', 'descendant']
      .map(key => row[key]).filter(Number.isInteger)))];
    assert.ok(pids.length >= 5, 'witness native, proxy, supervisor, job and detached descendant');
    const until = Date.now() + 2000;
    while (pids.some(isProcessAlive) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(pids.filter(isProcessAlive), [], 'every owned process must be reaped');
    const snapshot = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8'));
    const statuses = Object.values(snapshot.final_job_statuses);
    assert.ok(statuses.length && statuses.every(status => ['cancelled', 'failed', 'done'].includes(status)));
    if (mode !== 'supervisor-error') assert.deepEqual(statuses, ['cancelled']);
    else assert.deepEqual(statuses, ['failed']);
    console.log(`Native ConPTY lifetime passed: ${JSON.stringify({ ...receipt, ownedPids: pids, finalStatuses: statuses,
      allReaped: true, capture: capture.outputDir })}`);
  } finally {
    for (const row of await readPids()) {
      for (const key of ['native', 'proxy', 'supervisor', 'job', 'descendant']) {
        if (Number.isInteger(row[key]) && isProcessAlive(row[key])) await killProcessTree(row[key]);
      }
    }
  }
};
