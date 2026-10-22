import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createCrashLogger, readCrashEvidenceState } from '../../src/index/build/crash-log.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
const root = resolveTestCachePath(process.cwd(), `crash-terminal-owner-${crypto.randomUUID()}`);
const originalRename = fs.rename;
let entered;
let release;
const held = new Promise(resolve => { entered = resolve; });
const barrier = new Promise(resolve => { release = resolve; });
try {
  await fs.mkdir(root, { recursive: true });
  const logger = await createCrashLogger({ repoCacheRoot: root, enabled: true, buildId: 'build-A', attemptId: 'attempt-A', mode: 'code' });
  logger.updatePhase('before');
  await logger.flush();
  const logPath = path.join(root, 'logs', 'index-crash.log');
  const identity = await fs.stat(logPath, { bigint: true });
  let heldOnce = false;
  fs.rename = async (source, target) => {
    if (!heldOnce && target === path.join(root, 'logs', 'index-crash-state.json')) {
      heldOnce = true;
      entered();
      await barrier;
    }
    return originalRename(source, target);
  };
  logger.updatePhase('pending-before-error');
  await held;
  const evidence = logger.logError(new Error('original failure'));
  assert.equal(evidence.written, true);
  assert.equal((await readCrashEvidenceState(logger.paths)).phase, 'error');
  logger.updatePhase('after');
  logger.traceFileStage({ stage: 'after-error' });
  release();
  await logger.close();
  fs.rename = originalRename;
  const state = await readCrashEvidenceState(logger.paths);
  assert.equal(state.error.message, 'original failure');
  const legacyState = JSON.parse(await fs.readFile(path.join(root, 'logs', 'index-crash-state.json'), 'utf8'));
  assert.equal(legacyState.phase, 'error');
  const log = await fs.readFile(logPath, 'utf8');
  assert.ok(log.indexOf('phase before') < log.indexOf('original failure'));
  assert.ok(log.indexOf('original failure') < log.indexOf('phase after'));
  const after = await fs.stat(logPath, { bigint: true });
  assert.equal(after.ino, identity.ino, 'error logging never replaces a live append target');
  assert.equal(after.dev, identity.dev);
  const ownerLog = await fs.readFile(logger.paths.logPath, 'utf8');
  assert.match(ownerLog, /original failure/);
  const repeated = logger.logError(new Error('late shutdown diagnostic'));
  assert.notEqual(repeated.evidencePath, evidence.evidencePath, 'late/repeated errors retain separate authority');
  await fs.access(evidence.evidencePath);
  const moduleUrl = new URL('../../src/index/build/crash-log.js', import.meta.url).href;
  const runChild = name => new Promise((resolve, reject) => {
    const source = `import {createCrashLogger} from ${JSON.stringify(moduleUrl)}; const logger=await createCrashLogger({repoCacheRoot:${JSON.stringify(root)},enabled:true,attemptId:${JSON.stringify(name)}}); logger.updatePhase('child-before'); logger.logError({message:${JSON.stringify(name)}}); logger.updatePhase('child-after'); await logger.close();`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4096); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
  });
  await Promise.all([runChild('child-A'), runChild('child-B')]);
  const shared = await fs.readFile(logPath, 'utf8');
  assert.match(shared, /child-A/);
  assert.match(shared, /child-B/);
  assert.equal((shared.match(/phase child-after/g) || []).length, 2);
} finally {
  release?.();
  fs.rename = originalRename;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('crash append ownership and terminal precedence passed');
