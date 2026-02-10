#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { measureRepoMap } from '../../../src/index/build/artifacts/repo-map.js';

applyTestEnv();

const entries = [
  {
    file: 'src/a.js',
    ext: '.js',
    name: 'a',
    kind: 'function',
    signature: 'a()',
    startLine: 1,
    endLine: 3,
    exported: true
  },
  {
    file: 'src/b.js',
    ext: '.js',
    name: 'b',
    kind: 'function',
    signature: 'b()',
    startLine: 5,
    endLine: 9,
    exported: false
  }
];

const partialIds = new Map([
  ['src/a.js', 1]
]);
const partialMeasurement = measureRepoMap({
  repoMapIterator: () => entries.values(),
  fileIdByPath: partialIds
});
assert.equal(
  partialMeasurement.delta,
  null,
  'expected delta encoding to disable when any row is missing a file id'
);

const allIds = new Map([
  ['src/a.js', 1],
  ['src/b.js', 2]
]);
const fullMeasurement = measureRepoMap({
  repoMapIterator: () => entries.values(),
  fileIdByPath: allIds
});
assert.ok(fullMeasurement.delta, 'expected delta encoding when all rows have file ids');
assert.equal(fullMeasurement.delta.format, 'repo_map.delta.v1');

console.log('repo-map delta eligibility test passed');
