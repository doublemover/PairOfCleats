#!/usr/bin/env node
import assert from 'node:assert/strict';

import { validateBenchArgs, validateBuildArgs } from '../../src/shared/cli-options.js';

const capture = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
};

const buildUnknownError = capture(() => validateBuildArgs({ bogus: true }));
assert.ok(buildUnknownError instanceof Error, 'expected build validator to throw for unknown options');
assert.equal(buildUnknownError?.code, 'ERR_BUILD_ARG_VALIDATION');
assert.match(buildUnknownError?.message || '', /unknown options: bogus/i);
assert.deepEqual(buildUnknownError?.details, ['unknown option: bogus']);

const buildSchemaError = capture(() => validateBuildArgs({ threads: 'many' }));
assert.ok(buildSchemaError instanceof Error, 'expected build validator to throw for schema mismatch');
assert.equal(buildSchemaError?.code, 'ERR_BUILD_ARG_VALIDATION');
assert.match(buildSchemaError?.message || '', /build-index args validation failed/i);
assert.ok(Array.isArray(buildSchemaError?.details) && buildSchemaError.details.length > 0);

const benchUnknownError = capture(() => validateBenchArgs({ rogue: true }));
assert.ok(benchUnknownError instanceof Error, 'expected bench validator to throw for unknown options');
assert.equal(benchUnknownError?.code, 'ERR_BENCH_ARG_VALIDATION');
assert.match(benchUnknownError?.message || '', /unknown options: rogue/i);
assert.deepEqual(benchUnknownError?.details, ['unknown option: rogue']);

const benchConflictError = capture(() => validateBenchArgs({ ann: true, 'no-ann': true }));
assert.ok(benchConflictError instanceof Error, 'expected bench validator to throw for conflicting flags');
assert.equal(benchConflictError?.code, 'ERR_BENCH_ARG_VALIDATION');
assert.match(benchConflictError?.message || '', /ann and no-ann cannot both be set/i);
assert.deepEqual(benchConflictError?.details, ['ann and no-ann cannot both be set']);

console.log('cli option validators contract test passed');
