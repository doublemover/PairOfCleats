#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatBuildNonce } from '../../../src/index/build/runtime/config.js';

const nonceA = formatBuildNonce();
const nonceB = formatBuildNonce();

assert.match(nonceA, /^[0-9a-f]+$/i, 'expected build nonce to be hex');
assert.match(nonceB, /^[0-9a-f]+$/i, 'expected build nonce to be hex');
assert.ok(nonceA.length >= 4, 'expected build nonce length to be at least 4 characters');
assert.ok(nonceB.length >= 4, 'expected build nonce length to be at least 4 characters');
assert.notEqual(nonceA, nonceB, 'expected build nonces to differ across calls');

console.log('build id nonce contract test passed');
