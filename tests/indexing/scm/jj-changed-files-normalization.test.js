#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeJjPathList } from '../../../src/index/scm/providers/jj-parse.js';

const repoRoot = path.resolve('tests/fixtures/scm/jj');
const entries = [
  path.join('src', 'z.js'),
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
const literal = normalizeJjPathList({ entries: ['src\\z.js'], repoRoot });
assert.deepEqual(literal.filesPosix, [process.platform === 'win32' ? 'src/z.js' : 'src\\z.js'],
  'POSIX filename backslashes remain literal; native Windows separators normalize');

console.log('jj changed-files normalization ok');
