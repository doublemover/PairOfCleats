#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../helpers/test-env.js';
import {
  DEFAULT_BUILD_CLEANUP_TIMEOUT_MS,
  resolveBuildCleanupTimeoutMs
} from '../../src/index/build/cleanup-timeout.js';

ensureTestingEnv(process.env);

assert.equal(
  resolveBuildCleanupTimeoutMs(),
  DEFAULT_BUILD_CLEANUP_TIMEOUT_MS,
  'expected helper default when no candidates are provided'
);
assert.equal(
  resolveBuildCleanupTimeoutMs(null),
  DEFAULT_BUILD_CLEANUP_TIMEOUT_MS,
  'expected null cleanup timeout to be treated as unset'
);
assert.equal(
  resolveBuildCleanupTimeoutMs(undefined, 4321),
  4321,
  'expected undefined cleanup timeout to fall through to later candidates'
);
assert.equal(
  resolveBuildCleanupTimeoutMs('', 5555),
  5555,
  'expected empty-string cleanup timeout to be treated as unset'
);
assert.equal(
  resolveBuildCleanupTimeoutMs('   ', 6666),
  6666,
  'expected whitespace cleanup timeout to be treated as unset'
);
assert.equal(
  resolveBuildCleanupTimeoutMs(false, 7777),
  7777,
  'expected boolean false cleanup timeout to be treated as unset'
);
assert.equal(
  resolveBuildCleanupTimeoutMs(true, 8888),
  8888,
  'expected boolean true cleanup timeout to be treated as unset'
);
assert.equal(
  resolveBuildCleanupTimeoutMs(-1, 9999),
  9999,
  'expected negative cleanup timeout to be treated as unset'
);
assert.equal(
  resolveBuildCleanupTimeoutMs('invalid', 1234),
  1234,
  'expected invalid cleanup timeout text to be treated as unset'
);
assert.equal(
  resolveBuildCleanupTimeoutMs(0, 1234),
  0,
  'expected explicit zero cleanup timeout to disable timeout enforcement'
);
assert.equal(
  resolveBuildCleanupTimeoutMs('0', 1234),
  0,
  'expected explicit zero string cleanup timeout to disable timeout enforcement'
);
assert.equal(
  resolveBuildCleanupTimeoutMs(2500, 1234),
  2500,
  'expected first valid cleanup timeout candidate to win'
);

console.log('build cleanup timeout resolution test passed');
