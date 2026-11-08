import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { acquireFileLock, readLockInfo } from '../../../src/shared/locks/file-lock.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { skip } from '../../helpers/skip.js';

if (process.platform !== 'win32') skip('Native Windows FileDispositionInfo qualification; portable file-lock contracts run separately.');
const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('windows-lock-delete-pending');
const lockPath = path.join(dir, 'native.lock');
await fs.writeFile(lockPath, 'native holder; not a new admitted owner');
const originalOpen = fs.open;
const startHolder = target => {
  const startedAt = performance.now();
  const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    path.join(root, 'tests/fixtures/locks/windows-delete-pending.ps1'), target],
  { env: applyTestEnv({ syncProcess: false }), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  closed.catch(() => {});
  const state = { stdout: '', stderr: '', readyMs: null };
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const startupError = message => new Error(`${message}: ${JSON.stringify({
    elapsedMs: performance.now() - startedAt, exitCode: child.exitCode, signal: child.signalCode, ...state
  })}`);
  const startupDeadline = setTimeout(() => rejectReady(startupError('Native pending-delete holder did not start')), 5000);
  child.stderr.on('data', chunk => { state.stderr += chunk; });
  child.stdout.on('data', chunk => {
    state.stdout += chunk;
    if (state.readyMs === null && state.stdout.split(/\r?\n/).includes('native-delete-pending')) {
      state.readyMs = performance.now() - startedAt;
      clearTimeout(startupDeadline);
      resolveReady();
    }
  });
  child.on('error', rejectReady);
  child.on('close', () => {
    clearTimeout(startupDeadline);
    if (state.readyMs === null) rejectReady(startupError('Native pending-delete holder exited before readiness'));
  });
  return { child, closed, ready, state, async dispose() {
    clearTimeout(startupDeadline);
    if (child.pid && child.exitCode == null) { child.stdin.destroy(); child.kill(); }
    await closed.catch(() => {});
  } };
};
const holder = startHolder(lockPath);
const { child, closed, ready } = holder;
const observedErrors = [];
try {
  await ready;
  let observeDenied;
  const denied = new Promise(resolve => { observeDenied = resolve; });
  fs.open = async (target, flags, ...args) => {
    try { return await originalOpen(target, flags, ...args); }
    catch (error) {
      if (target === lockPath && flags === 'wx') {
        observedErrors.push(error.code);
        observeDenied();
      }
      throw error;
    }
  };
  const acquiring = acquireFileLock({ lockPath, waitMs: 1000, pollMs: 10 });
  // Attach rejection handling immediately, including against the old owner.
  acquiring.catch(() => {});
  await denied;
  assert.equal(observedErrors[0], 'EPERM', 'Actual native pending deletion must own the failure');
  child.stdin.end('\n');
  const [code] = await closed;
  assert.equal(code, 0, holder.state.stderr);
  assert.equal(holder.state.stderr, '');
  const lock = await acquiring;
  assert.ok(lock, 'Admission waits for the actual old native handle to close');
  assert.equal((await readLockInfo(lockPath)).lockId, lock.payload.lockId);
  assert.equal((await readLockInfo(lockPath)).pid, process.pid);
  assert.equal(await lock.release(), true);
} finally {
  fs.open = originalOpen;
  await holder.dispose();
}

const invalid = startHolder(path.join(dir, 'does-not-exist.lock'));
try {
  await assert.rejects(invalid.ready, /exited before readiness.*CreateFileW failed/s,
    'an actual native API failure reports its exit/phase/output instead of consuming the startup deadline');
  const [code] = await invalid.closed;
  assert.notEqual(code, 0);
  assert.equal(invalid.state.readyMs, null);
  assert.ok(invalid.state.stdout.includes('native-api-ready'));
} finally { await invalid.dispose(); }

const deniedOpen = code => Object.assign(new Error(`explicit ${code} open control`), { code, syscall: 'open' });
try {
  let attempts = 0;
  fs.open = async () => { attempts++; throw deniedOpen('EPERM'); };
  await assert.rejects(acquireFileLock({ lockPath, waitMs: 40, pollMs: 5 }), { code: 'EPERM' },
    'Persistent permission denial remains the original error after the existing bounded wait');
  assert.ok(attempts > 1);
  attempts = 0;
  await assert.rejects(acquireFileLock({ lockPath, waitMs: 0 }), { code: 'EPERM' });
  assert.equal(attempts, 1, 'Zero-wait callers retain immediate permission failure');
  attempts = 0;
  fs.open = async () => { attempts++; throw deniedOpen('EACCES'); };
  await assert.rejects(acquireFileLock({ lockPath, waitMs: 100 }), { code: 'EACCES' });
  assert.equal(attempts, 1, 'Other permission failures are not classified as pending deletion');
  const controller = new AbortController();
  fs.open = async () => { controller.abort(); throw deniedOpen('EPERM'); };
  await assert.rejects(acquireFileLock({ lockPath, waitMs: 100, signal: controller.signal }), { code: 'ABORT_ERR' });
} finally { fs.open = originalOpen; }
await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
console.log(JSON.stringify({ readyMs: holder.state.readyMs, nativePendingDelete: observedErrors, acquiredAfterHandleClose: true,
  persistentDenialPreserved: true, zeroWaitPreserved: true, cancellationPreserved: true }));
