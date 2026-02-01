#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compileSafeRegex } from '../../../src/shared/safe-regex.js';

const result = compileSafeRegex('a', '', { maxProgramSize: 1 });
assert.equal(result.regex, null, 'program size cap should reject');
assert.equal(result.error?.code, 'PROGRAM_TOO_LARGE');

console.log('safe regex program size cap ok');
