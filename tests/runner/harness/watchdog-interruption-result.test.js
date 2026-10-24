#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeResult, resolveAcceptanceExitCode } from '../run-results.js';
const interrupted = normalizeResult({ status: 'passed', exitCode: 0, interruption: { kind: 'watchdog', reason: 'stalled' }, timedOut: true });
assert.equal(interrupted.status, 'failed');
assert.equal(interrupted.timeoutClass, 'watchdog_interruption');
assert.equal(resolveAcceptanceExitCode([interrupted]), 1);
assert.equal(resolveAcceptanceExitCode([normalizeResult({ status: 'passed', exitCode: 0 })], { watchdogState: { triggered: true } }), 1);
