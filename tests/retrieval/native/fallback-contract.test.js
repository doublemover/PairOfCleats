#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  NATIVE_ACCEL_ERROR_CODES,
  negotiateNativeRuntime,
  resolveNativeFallback
} from '../../../src/shared/native-accel.js';

ensureTestingEnv(process.env);

const negotiation = negotiateNativeRuntime({
  abiVersion: 1,
  runtimeKind: 'native',
  featureBits: 0
});

assert.equal(negotiation.ok, false);
assert.equal(negotiation.code, NATIVE_ACCEL_ERROR_CODES.DISABLED_NO_GO);

const fallback = resolveNativeFallback(negotiation.code);
assert.equal(fallback.ok, true);
assert.equal(fallback.runtimeKind, 'js');
assert.equal(fallback.deterministic, true);
assert.equal(fallback.reasonCode, NATIVE_ACCEL_ERROR_CODES.DISABLED_NO_GO);

console.log('native fallback contract test passed');
