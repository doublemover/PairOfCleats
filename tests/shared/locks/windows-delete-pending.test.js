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
const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
  path.join(root, 'tests/fixtures/locks/windows-delete-pending.ps1'), lockPath],
{ env: applyTestEnv({ syncProcess: false }), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const closed = once(child, 'close');
let stderr = '', stdout = '', resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
const startupDeadline = setTimeout(() => rejectReady(new Error('Native pending-delete holder did not start')), 5000);
child.stderr.on('data', chunk => { stderr += chunk; });
child.stdout.on('data', chunk => {
  stdout += chunk;
  if (stdout.includes('native-delete-pending')) resolveReady();
});
child.on('error', rejectReady);
const observedErrors = [];
try {
  await ready;
  clearTimeout(startupDeadline);
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
  assert.equal(code, 0, stderr);
  assert.equal(stderr, '');
  const lock = await acquiring;
  assert.ok(lock, 'Admission waits for the actual old native handle to close');
  assert.equal((await readLockInfo(lockPath)).lockId, lock.payload.lockId);
  assert.equal((await readLockInfo(lockPath)).pid, process.pid);
  assert.equal(await lock.release(), true);
} finally {
  clearTimeout(startupDeadline);
  fs.open = originalOpen;
  if (child.exitCode == null) { child.stdin.end(); child.kill(); }
  await closed;
}

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
console.log(JSON.stringify({ nativePendingDelete: observedErrors, acquiredAfterHandleClose: true,
  persistentDenialPreserved: true, zeroWaitPreserved: true, cancellationPreserved: true }));
