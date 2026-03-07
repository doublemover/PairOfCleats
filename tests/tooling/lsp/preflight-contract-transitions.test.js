#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TOOLING_PREFLIGHT_REASON_CODES,
  TOOLING_PREFLIGHT_STATES,
  buildToolingPreflightDiagnostic,
  isValidToolingPreflightTransition,
  normalizeToolingPreflightResult
} from '../../../src/index/tooling/preflight/contract.js';

assert.equal(
  isValidToolingPreflightTransition(TOOLING_PREFLIGHT_STATES.IDLE, TOOLING_PREFLIGHT_STATES.RUNNING),
  true,
  'expected idle -> running transition to be valid'
);
assert.equal(
  isValidToolingPreflightTransition(TOOLING_PREFLIGHT_STATES.RUNNING, TOOLING_PREFLIGHT_STATES.READY),
  true,
  'expected running -> ready transition to be valid'
);
assert.equal(
  isValidToolingPreflightTransition(TOOLING_PREFLIGHT_STATES.READY, TOOLING_PREFLIGHT_STATES.RUNNING),
  false,
  'expected ready -> running transition to be invalid'
);

const blockedResult = normalizeToolingPreflightResult({
  blockSourcekit: true,
  timeout: false
});
assert.equal(blockedResult.state, TOOLING_PREFLIGHT_STATES.BLOCKED, 'expected blockSourcekit to coerce blocked state');
assert.equal(blockedResult.reasonCode, TOOLING_PREFLIGHT_REASON_CODES.LOCK_UNAVAILABLE);

const timeoutResult = normalizeToolingPreflightResult({
  state: 'degraded',
  timeout: true
});
assert.equal(timeoutResult.state, TOOLING_PREFLIGHT_STATES.DEGRADED);
assert.equal(timeoutResult.reasonCode, TOOLING_PREFLIGHT_REASON_CODES.TIMEOUT);

const diagnostic = buildToolingPreflightDiagnostic({
  providerId: 'sourcekit',
  preflightId: 'sourcekit.package-resolution',
  state: TOOLING_PREFLIGHT_STATES.READY,
  reasonCode: TOOLING_PREFLIGHT_REASON_CODES.CACHE_HIT,
  message: 'cached preflight',
  durationMs: 11,
  timedOut: false,
  cached: true,
  startedAtMs: 100,
  finishedAtMs: 111
});
assert.equal(diagnostic.providerId, 'sourcekit');
assert.equal(diagnostic.preflightId, 'sourcekit.package-resolution');
assert.equal(diagnostic.state, TOOLING_PREFLIGHT_STATES.READY);
assert.equal(diagnostic.reasonCode, TOOLING_PREFLIGHT_REASON_CODES.CACHE_HIT);
assert.equal(diagnostic.durationMs, 11);
assert.equal(diagnostic.cached, true);
assert.equal(typeof diagnostic.startedAt, 'string');
assert.equal(typeof diagnostic.finishedAt, 'string');

console.log('tooling preflight contract transitions test passed');
