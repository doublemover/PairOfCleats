#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createToolingLifecycleHealth } from '../../../src/integrations/tooling/providers/shared.js';

const health = createToolingLifecycleHealth({
  name: 'lsp-lifecycle-test',
  restartWindowMs: 2000,
  maxRestartsPerWindow: 3,
  fdPressureBackoffMs: 400,
  log: () => {}
});

const base = Date.now();
health.onLifecycleEvent({ kind: 'start', at: base });
health.onLifecycleEvent({ kind: 'exit', at: base + 50, code: 1 });
health.onLifecycleEvent({ kind: 'start', at: base + 100 });
health.onLifecycleEvent({ kind: 'error', at: base + 150, code: 'EPIPE' });
health.onLifecycleEvent({ kind: 'start', at: base + 200 });

const crashState = health.getState();
assert.equal(crashState.crashLoopTrips >= 1, true, 'expected crash-loop trip to be recorded');
assert.equal(
  crashState.crashLoopQuarantined,
  true,
  'expected crash-loop quarantine to be active within restart window'
);

health.noteStderrLine('EMFILE: too many open files while reading');
const fdState = health.getState();
assert.equal(fdState.fdPressureEvents >= 1, true, 'expected fd pressure event to be counted');
assert.equal(fdState.fdPressureBackoffActive, true, 'expected fd pressure backoff to activate');

console.log('LSP lifecycle health test passed');
