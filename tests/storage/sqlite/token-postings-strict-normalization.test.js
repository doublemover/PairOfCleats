#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeTfPostingRows } from '../../../src/storage/sqlite/build/from-artifacts/sources.js';
import { INTEGER_COERCE_MODE_STRICT } from '../../../src/shared/number-coerce.js';

assert.throws(
  () => normalizeTfPostingRows([[1]], {
    mode: INTEGER_COERCE_MODE_STRICT,
    rejectInvalid: true,
    contextLabel: 'strict singleton malformed'
  }),
  /cardinality invariant failed/i,
  'expected malformed singleton posting to fail strict validation'
);

assert.throws(
  () => normalizeTfPostingRows([[7, 'not-an-int']], {
    mode: INTEGER_COERCE_MODE_STRICT,
    rejectInvalid: true,
    contextLabel: 'strict singleton tf'
  }),
  /non-integer tf/i,
  'expected singleton posting with non-integer tf to fail strict validation'
);

const valid = normalizeTfPostingRows([[7, 2]], {
  mode: INTEGER_COERCE_MODE_STRICT,
  rejectInvalid: true
});
assert.deepEqual(valid, [[7, 2]], 'expected valid singleton posting to pass strict validation');

console.log('token postings strict normalization test passed');
