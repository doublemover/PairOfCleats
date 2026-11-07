// Actual diagnostic publishers with tiny disposable files; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCrashLogger, readCrashEvidenceState } from '../../src/index/build/crash-log.js';
import { createLoggerScope } from '../../src/shared/progress-runtime.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const temporary = await makeTempDir('poc-crash-independent-sinks-');
const originalRename = fs.rename, originalRenameSync = fsSync.renameSync, originalWarn = console.warn;
const warnings = [];
const scope = createLoggerScope({ structured: false, ringMax: 8 });
scope.setProgressHandlers({ log() {} });
let active = null;
try {
  console.warn = (...values) => warnings.push(values.join(' '));
  for (const denied of ['legacy', 'attempt', null]) {
    const repoCacheRoot = path.join(temporary, denied || 'normal');
    const logger = await createCrashLogger({ repoCacheRoot, enabled: true, buildId: 'bounded-sink-build',
      attemptId: `bounded-${denied || 'normal'}`, mode: 'code' });
    active = logger;
    const legacyState = path.join(repoCacheRoot, 'logs', 'index-crash-state.json');
    const legacyEvents = path.join(repoCacheRoot, 'logs', 'index-crash-events.json');
    const deniedState = denied === 'legacy' ? legacyState : denied === 'attempt' ? logger.paths.statePath : null;
    const deniedEvents = denied === 'legacy' ? legacyEvents : denied === 'attempt' ? logger.paths.eventsPath : null;
    const healthyState = denied === 'legacy' ? logger.paths.statePath : legacyState;
    const healthyEvents = denied === 'legacy' ? logger.paths.eventsPath : legacyEvents;
    const renameFailure = Object.freeze(Object.assign(new Error(`controlled ${denied} state sink denial`), { code: 'EIO' }));
    const eventsFailure = Object.freeze(Object.assign(new Error(`controlled ${denied} events sink denial`), { code: 'EIO' }));
    const before = warnings.length;
    fs.rename = async (source, target) => {
      if (target === deniedState) throw renameFailure;
      return originalRename(source, target);
    };
    fsSync.renameSync = (source, target) => {
      if (target === deniedEvents) throw eventsFailure;
      return originalRenameSync(source, target);
    };

    logger.updatePhase('phase-with-independent-sinks');
    await logger.flush();
    const state = JSON.parse(await fs.readFile(healthyState, 'utf8'));
    assert.equal(state.phase, 'phase-with-independent-sinks');
    assert.equal(state.attemptId, logger.identity.attemptId);
    assert.equal(state.evidenceOwnerId, logger.identity.evidenceOwnerId);
    if (deniedState) await assert.rejects(fs.stat(deniedState), { code: 'ENOENT' });
    else assert.equal(JSON.parse(await fs.readFile(logger.paths.statePath, 'utf8')).phase, state.phase);

    const primary = Object.freeze(Object.assign(new Error(`original ${denied || 'normal'} failure`), { code: 'ORIGINAL_FAILURE' }));
    let evidence;
    scope.run(() => {
      scope.log('bounded prior event', { token: 'must-not-survive-redaction', ordinal: 1 });
      evidence = logger.logError(primary);
    });
    assert.equal(evidence.written, true);
    assert.equal(evidence.attemptId, logger.identity.attemptId);
    const events = await fs.readFile(healthyEvents, 'utf8');
    assert.match(events, /bounded prior event/);
    assert.ok(!events.includes('must-not-survive-redaction'));
    if (deniedEvents) await assert.rejects(fs.stat(deniedEvents), { code: 'ENOENT' });
    else assert.match(await fs.readFile(logger.paths.eventsPath, 'utf8'), /bounded prior event/);
    logger.updatePhase('late-phase-cannot-replace-terminal');
    await logger.close(); active = null;
    const terminal = await readCrashEvidenceState(logger.paths);
    assert.equal(terminal.phase, 'error');
    assert.equal(terminal.error.message, primary.message);
    assert.equal(terminal.error.code, 'ORIGINAL_FAILURE');
    assert.equal(primary.cause, undefined, 'diagnostic sink failures do not modify the frozen primary');
    const observed = warnings.slice(before);
    if (denied) {
      const prefix = denied === 'attempt' ? 'attempt ' : '';
      assert.equal(observed.filter(line => line.startsWith(`[crash-log] write ${prefix}crash state failed`)).length, 1);
      assert.equal(observed.filter(line => line.startsWith(`[crash-log] write ${prefix}crash events snapshot failed`)).length, 1);
      assert.equal(observed.length, 2, 'only the two deliberately denied sinks may warn');
    } else assert.deepEqual(observed, [], 'normal sinks retain warning-free state/events publication');
    fs.rename = originalRename; fsSync.renameSync = originalRenameSync;
  }
} finally {
  fs.rename = originalRename; fsSync.renameSync = originalRenameSync;
  await active?.close();
  console.warn = originalWarn;
  await scope.close();
  await rmDirRecursive(temporary);
}
console.log('Independent crash state/events sink controls authored; execution deferred.');
