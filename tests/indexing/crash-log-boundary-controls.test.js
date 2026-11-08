import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCrashLogger, readCrashEvidenceState } from '../../src/index/build/crash-log.js';
import { resolveConfirmedCrashEvidencePath } from '../../src/index/build/crash-evidence.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('crash-log-boundary-controls/')[1];
assert.ok(['before-open', 'pending-write-close', 'bounded-existing-logs', 'terminal-disk-failure', 'latest-pointer-failure'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`crash-log-boundary-${selected}`);
const legacyLog = path.join(dir, 'logs', 'index-crash.log');
const original = { open: fs.open, readFile: fs.readFile, readFileSync: fsSync.readFileSync,
  renameSync: fsSync.renameSync, warn: console.warn };
const warnings = [];
console.warn = (...values) => warnings.push(values.join(' '));
let logger, release, entered;
const barrier = new Promise(resolve => { release = resolve; });
const blocked = new Promise(resolve => { entered = resolve; });
const primary = Object.freeze(Object.assign(new Error('original failure token=private-qualification-value'), { code: 'ORIGINAL_FAILURE' }));
const bounded = promise => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Controlled append did not reach its barrier')), 2000); })])
    .finally(() => clearTimeout(timer));
};
try {
  let heldOnce = false;
  if (selected === 'before-open') fs.open = async (...values) => {
    if (!heldOnce && values[0] === legacyLog) { heldOnce = true; entered(); await barrier; }
    return original.open(...values);
  };
  if (selected === 'pending-write-close') fs.open = async (...values) => {
    const handle = await original.open(...values);
    if (values[0] === legacyLog) {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async bytes => {
        if (!heldOnce && String(bytes).includes('phase pending-native-write')) {
          heldOnce = true; entered(); await barrier;
        }
        return write(bytes);
      };
    }
    return handle;
  };
  logger = await createCrashLogger({ repoCacheRoot: dir, enabled: true,
    buildId: 'boundary-build', attemptId: selected, mode: 'code' });
  let evidence, close, closed = false;
  if (selected === 'before-open' || selected === 'pending-write-close') {
    if (selected === 'pending-write-close') {
      await logger.flush();
      logger.updatePhase('pending-native-write');
    }
    await bounded(blocked);
    evidence = logger.logError(primary);
    assert.equal(evidence.written, true);
    logger.updatePhase('after-primary-error');
    close = logger.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false, 'close retains the actual pending append operation');
    const duringClose = logger.logError(new Error('secondary error while closing'));
    assert.equal(duringClose.written, true);
    assert.notEqual(duringClose.evidencePath, evidence.evidencePath);
    release(); await close;
    for (const logPath of [legacyLog, logger.paths.logPath]) {
      const text = await fs.readFile(logPath, 'utf8');
      assert.ok(text.includes('original failure'), 'original admitted error stays discoverable');
      assert.ok(text.indexOf('original failure') < text.indexOf('phase after-primary-error'));
      assert.ok(!text.includes('private-qualification-value'));
    }
    const originalTerminal = JSON.parse(await fs.readFile(evidence.evidencePath, 'utf8'));
    assert.equal(originalTerminal.error.code, 'ORIGINAL_FAILURE');
    const state = JSON.parse(await fs.readFile(logger.paths.statePath, 'utf8'));
    assert.equal(state.phase, 'error'); assert.equal(state.error.code, 'ORIGINAL_FAILURE');
    const late = logger.logError(new Error('late error after confirmed close'));
    assert.equal(late.written, true); assert.notEqual(late.evidencePath, evidence.evidencePath);
    await fs.access(evidence.evidencePath);
    assert.equal((await readCrashEvidenceState(logger.paths)).phase, 'error');
  } else {
    await logger.flush();
    const logs = new Set([legacyLog, logger.paths.logPath]);
    const identities = new Map();
    for (const logPath of logs) {
      await fs.appendFile(logPath, Buffer.alloc(2 * 1024 * 1024, 'x'));
      identities.set(logPath, await fs.stat(logPath, { bigint: true }));
    }
    let reads = 0, replacements = 0;
    const guard = target => {
      if (logs.has(String(target))) { reads += 1; throw new Error('Error handling must not read accumulated append logs'); }
    };
    fs.readFile = (...values) => { guard(values[0]); return original.readFile(...values); };
    fsSync.readFileSync = (...values) => { guard(values[0]); return original.readFileSync(...values); };
    const diskFailure = Object.freeze(Object.assign(new Error('controlled terminal disk full'), { code: 'ENOSPC' }));
    fsSync.renameSync = (source, target) => {
      if (logs.has(String(target))) { replacements += 1; throw new Error('Error handling must not replace a live append target'); }
      if (selected === 'terminal-disk-failure' && String(target).endsWith('.terminal.json')) throw diskFailure;
      if (selected === 'latest-pointer-failure' && target === logger.paths.terminalPath) throw diskFailure;
      return original.renameSync(source, target);
    };
    evidence = logger.logError(primary);
    assert.equal(evidence.written, selected !== 'terminal-disk-failure');
    if (selected === 'terminal-disk-failure') {
      assert.equal(evidence.writeError.code, 'ERR_ATOMIC_WRITE');
      assert.equal(evidence.writeError.causeCode, 'ENOSPC');
      assert.equal(evidence.evidencePath, null);
    } else {
      assert.ok((await fs.stat(evidence.evidencePath)).size <= 128 * 1024,
        'terminal evidence stays inside the public reader byte allowance, independent of prior log size');
      const terminal = await fs.readFile(evidence.evidencePath, 'utf8');
      assert.ok(!terminal.includes('private-qualification-value'));
      assert.equal(resolveConfirmedCrashEvidencePath(evidence), evidence.evidencePath);
      if (selected === 'latest-pointer-failure') {
        assert.equal(evidence.latestWriteError.code, 'ERR_ATOMIC_WRITE');
        assert.equal(evidence.latestWriteError.causeCode, 'ENOSPC');
        await assert.rejects(fs.stat(logger.paths.terminalPath), { code: 'ENOENT' });
      }
    }
    logger.updatePhase('after-diagnostic-write');
    await logger.close();
    assert.equal(reads, 0); assert.equal(replacements, 0);
    for (const logPath of logs) {
      const after = await fs.stat(logPath, { bigint: true }), before = identities.get(logPath);
      assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
      assert.ok(after.size > before.size);
    }
    const terminal = await readCrashEvidenceState(logger.paths);
    assert.equal(terminal.phase, 'error'); assert.equal(terminal.error.code, primary.code);
    if (selected === 'terminal-disk-failure') assert.equal(terminal.diagnosticEvidence.written, false);
  }
  assert.equal(primary.cause, undefined, 'diagnostic loss never modifies the frozen primary error');
  assert.equal(primary.code, 'ORIGINAL_FAILURE');
  assert.equal(primary.message, 'original failure token=private-qualification-value');
  assert.deepEqual(warnings, [], 'successful sinks and explicitly returned diagnostic-loss outcomes do not emit unexpected warnings');
} finally {
  release(); fs.open = original.open; fs.readFile = original.readFile;
  fsSync.readFileSync = original.readFileSync; fsSync.renameSync = original.renameSync;
  try { await logger?.close(); } finally { console.warn = original.warn; }
}
console.log(`Crash-log boundary ${selected} passed.`);
