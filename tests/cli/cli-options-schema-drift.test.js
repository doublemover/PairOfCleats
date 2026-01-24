#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  INDEX_BUILD_OPTIONS,
  INDEX_BUILD_SCHEMA,
  BENCH_OPTIONS,
  BENCH_SCHEMA
} from '../../src/shared/cli-options.js';

const sortedKeys = (value) => Object.keys(value || {}).sort();

assert.deepStrictEqual(
  sortedKeys(INDEX_BUILD_OPTIONS),
  sortedKeys(INDEX_BUILD_SCHEMA.properties),
  'INDEX_BUILD_SCHEMA must match INDEX_BUILD_OPTIONS'
);
assert.strictEqual(INDEX_BUILD_SCHEMA.additionalProperties, false, 'INDEX_BUILD_SCHEMA must reject unknown fields');

assert.deepStrictEqual(
  sortedKeys(BENCH_OPTIONS),
  sortedKeys(BENCH_SCHEMA.properties),
  'BENCH_SCHEMA must match BENCH_OPTIONS'
);
assert.strictEqual(BENCH_SCHEMA.additionalProperties, false, 'BENCH_SCHEMA must reject unknown fields');

console.log('cli options schema drift test passed');
