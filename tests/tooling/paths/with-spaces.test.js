#!/usr/bin/env node
import assert from 'node:assert/strict';
import { joinPathSafe, normalizePathForPlatform } from '../../../src/shared/path-normalize.js';

const platform = process.platform === 'win32' ? 'win32' : 'posix';
const base = platform === 'win32'
  ? 'C:\\Program Files\\Pair Of Cleats'
  : '/tmp/pair of cleats';

const joined = joinPathSafe(base, ['fixtures with spaces', 'sample repo', 'index_state.json'], { platform });
assert.ok(joined, 'expected joinPathSafe to keep paths with spaces');
assert.ok(joined.includes('fixtures with spaces'), 'joined path should preserve spaced segment');

const normalized = normalizePathForPlatform(joined, { platform });
assert.equal(normalized, joined, 'normalizing an already-safe path should be stable');

console.log('paths-with-spaces test passed');
