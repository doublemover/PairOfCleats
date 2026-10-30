// Explicit native Windows qualification; no editor, ACL or privileged launch.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { resolveConfirmedCrashEvidencePath } from '../../../src/index/build/crash-evidence.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { isProcessAlive } from '../../../src/shared/locks/file-lock-owner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

assert.equal(process.platform, 'win32', 'Actual Windows sharing semantics require Windows.');
const { dir } = await prepareIsolatedTestCacheDir('crash-log-native-sharing');
const warnings = [], warn = console.warn;
console.warn = (...values) => warnings.push(values.join(' '));
const logger = await createCrashLogger({ repoCacheRoot: dir, enabled: true,
  buildId: 'sharing-build', attemptId: 'sharing-attempt', mode: 'code' });
let holder;
try {
  const first = logger.logError(Object.assign(new Error('first failure'), { code: 'FIRST' }));
  assert.equal(first.written, true); await logger.flush();
  const original = await fs.readFile(logger.paths.terminalPath, 'utf8');
  holder = spawnSubprocess('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    path.resolve('tests/fixtures/tui/hold-install-metadata.ps1'), logger.paths.terminalPath, dir],
  { cwd: process.cwd(), env: applyTestEnv({ syncProcess: false }), stdio: 'pipe',
    timeoutMs: 14000, maxOutputBytes: 16384, rejectOnNonZeroExit: false });
  holder.catch(() => {});
  const deadline = Date.now() + 8000;
  while (true) {
    try { await fs.access(path.join(dir, 'metadata-held')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.ok(Date.now() < deadline, 'Actual Windows reader did not acknowledge its held file');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const primary = Object.freeze(Object.assign(new Error('original token=windows-share-private'), { code: 'PRIMARY' }));
  const denied = logger.logError(primary);
  assert.equal(denied.written, true, 'a denied convenience path cannot invalidate immutable terminal evidence');
  assert.equal(denied.latestWriteError.code, 'ERR_ATOMIC_WRITE');
  assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(denied.latestWriteError.causeCode), JSON.stringify(denied.latestWriteError));
  assert.equal(await fs.readFile(logger.paths.terminalPath, 'utf8'), original);
  assert.equal(resolveConfirmedCrashEvidencePath(denied), denied.evidencePath);
  const terminal = JSON.parse(await fs.readFile(denied.evidencePath, 'utf8'));
  assert.equal(terminal.error.code, 'PRIMARY'); assert.ok(!terminal.error.message.includes('windows-share-private'));
  assert.equal(primary.message, 'original token=windows-share-private');
  await fs.writeFile(path.join(dir, 'release-metadata'), 'release');
  const released = await holder;
  assert.equal(released.exitCode, 0, released.stderr); assert.equal(isProcessAlive(released.pid), false);
  const after = logger.logError(Object.assign(new Error('after confirmed reader release'), { code: 'AFTER_RELEASE' }));
  assert.equal(after.written, true); assert.equal(after.latestWriteError, undefined);
  assert.equal(JSON.parse(await fs.readFile(logger.paths.terminalPath, 'utf8')).error.code, 'AFTER_RELEASE');
  await fs.access(first.evidencePath); await fs.access(denied.evidencePath);
  await logger.close();
  assert.deepEqual(warnings, []);
  const receipt = { platform: process.platform, node: process.version, directory: dir,
    denial: denied.latestWriteError, immutableRecord: denied.evidencePath, originalPointerRetained: true,
    afterReleasePublished: true, helperPid: released.pid, helperExitCode: released.exitCode, helperReaped: true };
  await fs.writeFile(path.join(dir, 'qualification-receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await fs.writeFile(path.join(dir, 'release-metadata'), 'release');
  await holder?.catch(() => {});
  try { await logger.close(); } finally { console.warn = warn; }
}
