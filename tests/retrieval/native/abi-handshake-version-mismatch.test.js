#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  NATIVE_ACCEL_ABI_VERSION,
  NATIVE_ACCEL_ERROR_CODES,
  negotiateNativeRuntime
} from '../../../src/shared/native-accel.js';

ensureTestingEnv(process.env);

const result = negotiateNativeRuntime({
  abiVersion: NATIVE_ACCEL_ABI_VERSION + 1,
  runtimeKind: 'native',
  featureBits: 7
});

assert.equal(result.ok, false);
assert.equal(result.code, NATIVE_ACCEL_ERROR_CODES.ABI_MISMATCH);
assert.equal(result.expectedAbiVersion, NATIVE_ACCEL_ABI_VERSION);
assert.equal(result.fallbackRuntimeKind, 'js');

console.log('native abi handshake mismatch test passed');
