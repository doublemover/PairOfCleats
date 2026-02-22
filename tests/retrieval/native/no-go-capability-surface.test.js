#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { getCapabilities } from '../../../src/shared/capabilities.js';
import { getNativeAccelCapabilities } from '../../../src/shared/native-accel.js';

ensureTestingEnv(process.env);

const caps = getCapabilities({ refresh: true });
const nativeCaps = getNativeAccelCapabilities();

assert.equal(nativeCaps.enabled, false);
assert.equal(nativeCaps.runtimeKind, 'js');
assert.equal(nativeCaps.decision, 'no-go');

assert.equal(caps?.nativeAccel?.enabled, false);
assert.equal(caps?.nativeAccel?.runtimeKind, 'js');
assert.equal(caps?.nativeAccel?.abiVersion, 1);

console.log('native no-go capability surface test passed');
