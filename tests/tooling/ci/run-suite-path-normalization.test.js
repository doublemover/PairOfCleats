#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { splitPathEntries } from '../../../src/index/tooling/binary-utils.js';
import { __buildSuiteEnvForTests } from '../../../tools/ci/run-suite.js';

const root = process.cwd();
const firstPathEntry = path.join(root, '.testLogs', 'run-suite-path-a');
const secondPathEntry = path.join(root, '.testLogs', 'run-suite-path-b');
const thirdPathEntry = path.dirname(process.execPath);

const env = __buildSuiteEnvForTests('ci', {
  PATH: `${firstPathEntry}${path.delimiter}${thirdPathEntry}`,
  Path: `${secondPathEntry}${path.delimiter}${thirdPathEntry}`
});

const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path');
assert.equal(pathKeys.length, 1, 'expected buildSuiteEnv to normalize PATH/Path to a single key');

const normalizedEntries = splitPathEntries(env[pathKeys[0]]);
const normalizeForCompare = (value) => process.platform === 'win32'
  ? String(value || '').toLowerCase()
  : String(value || '');
const normalizedSet = new Set(normalizedEntries.map(normalizeForCompare));
assert.ok(normalizedSet.has(normalizeForCompare(firstPathEntry)), 'expected PATH entry preserved after normalization');
assert.ok(normalizedSet.has(normalizeForCompare(secondPathEntry)), 'expected Path entry preserved after normalization');
assert.ok(normalizedSet.has(normalizeForCompare(thirdPathEntry)), 'expected executable PATH entry preserved');
assert.equal(env.PAIROFCLEATS_TESTING, '1', 'expected suite env builder to force testing mode');

console.log('run-suite PATH normalization test passed');
