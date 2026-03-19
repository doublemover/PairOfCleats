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
health.noteHandshakeFailure({ at: base + 210, code: 'initialize_failed', message: 'bad initialize payload' });
health.noteRequestTimeout({ at: base + 220, code: 'ERR_LSP_REQUEST_TIMEOUT', message: 'request timeout' });
health.onLifecycleEvent({ kind: 'protocol_parse_error', at: base + 230, message: 'unexpected token' });

const crashState = health.getState();
assert.equal(crashState.crashLoopTrips >= 1, true, 'expected crash-loop trip to be recorded');
assert.equal(
  crashState.crashLoopQuarantined,
  true,
  'expected crash-loop quarantine to be active within restart window'
);
assert.equal(crashState.startupFailures >= 2, true, 'expected startup failures to be counted before handshake');
assert.equal(crashState.handshakeFailures, 1, 'expected handshake failures to be counted');
assert.equal(crashState.requestTimeouts, 1, 'expected request timeout count');
assert.equal(crashState.protocolParseFailures, 1, 'expected protocol parse failures to be counted');
assert.equal(
  crashState.lastFailureCategory?.category,
  'protocol_parse_failure',
  'expected last failure category to reflect most recent reliability failure'
);

health.noteStderrLine('EMFILE: too many open files while reading');
const fdState = health.getState();
assert.equal(fdState.fdPressureEvents >= 1, true, 'expected fd pressure event to be counted');
assert.equal(fdState.fdPressureBackoffActive, true, 'expected fd pressure backoff to activate');
assert.equal(fdState.fdPressureDensityPerMinute > 0, true, 'expected fd pressure density to be reported');
assert.equal(fdState.requestTimeoutRatePerMinute > 0, true, 'expected timeout rate to be reported');
assert.equal(fdState.protocolParseFailureRatePerMinute > 0, true, 'expected protocol parse rate to be reported');

console.log('LSP lifecycle health test passed');
