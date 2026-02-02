#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeJjPathList } from '../../../src/index/scm/providers/jj-parse.js';

const repoRoot = path.resolve('tests/fixtures/scm/jj');
const entries = [
  'src\\z.js',
  path.join(repoRoot, 'src', 'b.js'),
  'src/a.js',
  '../outside.js'
];

const { filesPosix, truncated } = normalizeJjPathList({
  entries,
  repoRoot,
  subdir: 'src',
  maxCount: 2
});

assert.equal(truncated, true);
assert.deepEqual(filesPosix, ['src/a.js', 'src/b.js']);

console.log('jj changed-files normalization ok');
