#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSafeRegex, normalizeSafeRegexConfig } from '../../src/shared/safe-regex.js';

const normalized = normalizeSafeRegexConfig({ flags: 'usmgii' });
assert.equal(normalized.flags, 'gims', 'flags should be canonicalized and drop unsupported flags');

const regex = createSafeRegex('a', 'smgi', { flags: 'i' });
assert(regex, 'regex should compile');
assert.equal(regex.flags, 'gims', 'regex flags should be canonicalized');

console.log('safe regex flags normalization ok');
