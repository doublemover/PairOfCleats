import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { killProcessTree } from '../../../src/shared/kill-tree.js';
import { spawnSubprocessSync, SubprocessTimeoutError } from '../../../src/shared/subprocess/runner.js';
import { isSyncCommandTimedOut, runSyncCommandWithTimeout } from '../../../src/shared/subprocess/sync-command.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('shared/subprocess/sync-timeout-detached-tree/')[1];
assert.ok(['runner', 'raw', 'runner-single', 'raw-single'].includes(selected));
const killTree = !selected.endsWith('-single');
const { dir } = await prepareIsolatedTestCacheDir(`sync-timeout-detached-tree-${selected}`);
const pidFile = path.join(dir, 'descendant.pid');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const script = `const fs = require('node:fs'); const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(0),25000);setInterval(()=>{},60000)'],
    { stdio: 'ignore', detached: process.platform === 'win32', windowsHide: true });
  fs.writeFileSync(process.argv[1], String(child.pid)); setInterval(()=>{},60000);`;
let descendant;
try {
  const startedAt = Date.now();
  if (selected.startsWith('runner')) {
    assert.throws(() => spawnSubprocessSync(process.execPath, ['-e', script, pidFile], {
      stdio: 'ignore', timeoutMs: 2000, killTree
    }), error => error instanceof SubprocessTimeoutError);
  } else {
    const result = runSyncCommandWithTimeout(process.execPath, ['-e', script, pidFile], {
      stdio: 'ignore', timeoutMs: 2000, killTree
    });
    assert.equal(isSyncCommandTimedOut(result), true);
    assert.equal(alive(result.pid), false, 'spawnSync has already reaped the original parent');
  }
  const elapsedMs = Date.now() - startedAt;
  descendant = Number(await fs.readFile(pidFile, 'utf8'));
  assert.ok(Number.isInteger(descendant) && descendant > 0);
  // POSIX init may reap an orphan asynchronously. Windows must have completed
  // native tree cleanup before returning to the caller.
  if (killTree && process.platform !== 'win32') {
    const reapDeadline = Date.now() + 2500;
    while (alive(descendant) && Date.now() < reapDeadline) await new Promise(resolve => setTimeout(resolve, 25));
  }
  console.log(JSON.stringify({ owner: selected, descendant, elapsedMs, alive: alive(descendant) }));
  assert.equal(alive(descendant), !killTree, killTree
    ? 'the production sync owner must reap a surviving detached Windows descendant'
    : 'killTree:false retains explicit single-process cleanup authority');
  assert.ok(elapsedMs < 10000, 'cleanup settles before the self-limiting descendant could exit naturally');
} finally {
  if (descendant && alive(descendant)) await killProcessTree(descendant, { graceMs: 0 });
}
