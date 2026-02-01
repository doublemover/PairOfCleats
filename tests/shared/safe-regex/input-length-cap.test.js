#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compileSafeRegex } from '../../../src/shared/safe-regex.js';

const { regex } = compileSafeRegex('a', 'g', { maxInputLength: 1 });
assert(regex, 'regex should compile');
assert.equal(regex.test('aa'), false, 'input length cap should reject oversized input');
assert.equal(regex.lastIndex, 0, 'lastIndex should reset when input is rejected');

console.log('safe regex input length cap ok');
