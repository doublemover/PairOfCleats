#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveWriteStartTimestampMs } from '../../../src/index/build/artifacts-write.js';

ensureTestingEnv(process.env);

const fallbackNowMs = 12_345;

assert.equal(
  resolveWriteStartTimestampMs(null, fallbackNowMs),
  fallbackNowMs,
  'expected null prefetched start to use fallback dispatch timestamp'
);
assert.equal(
  resolveWriteStartTimestampMs(undefined, fallbackNowMs),
  fallbackNowMs,
  'expected undefined prefetched start to use fallback dispatch timestamp'
);
assert.equal(
  resolveWriteStartTimestampMs(0, fallbackNowMs),
  fallbackNowMs,
  'expected zero prefetched start to use fallback dispatch timestamp'
);
assert.equal(
  resolveWriteStartTimestampMs('1771748352000', fallbackNowMs),
  1_771_748_352_000,
  'expected numeric prefetched start to be preserved'
);
assert.equal(
  resolveWriteStartTimestampMs(-1, fallbackNowMs),
  fallbackNowMs,
  'expected negative prefetched start to use fallback dispatch timestamp'
);
assert.equal(
  resolveWriteStartTimestampMs('not-a-number', fallbackNowMs),
  fallbackNowMs,
  'expected invalid prefetched start to use fallback dispatch timestamp'
);

console.log('artifact write start timestamp test passed');
