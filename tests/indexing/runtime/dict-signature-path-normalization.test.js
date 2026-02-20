#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeDictSignaturePath } from '../../../src/index/build/runtime/normalize.js';

const repoRoot = path.resolve('repo-root');
const dictDir = path.join(repoRoot, 'dicts');
const dictFile = path.join(dictDir, 'custom', 'terms.txt');

assert.equal(
  normalizeDictSignaturePath({ dictFile, dictDir, repoRoot }),
  'custom/terms.txt',
  'dict files under dictDir should normalize to dictDir-relative posix paths'
);

assert.equal(
  normalizeDictSignaturePath({ dictFile: dictDir, dictDir, repoRoot }),
  '',
  'dict dir root path should normalize to empty relative path'
);

const repoFile = path.join(repoRoot, 'rules', 'keywords.txt');
assert.equal(
  normalizeDictSignaturePath({ dictFile: repoFile, repoRoot }),
  'rules/keywords.txt',
  'dict files under repoRoot should normalize to repo-relative posix paths'
);

const outsideFile = path.resolve(path.join('..', 'outside-dict.txt'));
const outsideNormalized = normalizeDictSignaturePath({ dictFile: outsideFile, dictDir, repoRoot });
assert.equal(outsideNormalized.includes('\\'), false, 'outside fallback path should use posix separators');
assert.equal(outsideNormalized.endsWith('/outside-dict.txt'), true, 'outside fallback should retain absolute identity');

if (process.platform === 'win32') {
  const winRepoRoot = 'C:\\Repo\\Work';
  const winDictDir = 'C:\\Repo\\Work\\dict';
  const winDictFileLower = 'c:\\repo\\work\\dict\\main.txt';
  assert.equal(
    normalizeDictSignaturePath({
      dictFile: winDictFileLower,
      dictDir: winDictDir,
      repoRoot: winRepoRoot
    }),
    'main.txt',
    'windows path casing differences should still normalize to stable relative paths'
  );
}

console.log('dict signature path normalization test passed');
