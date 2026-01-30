#!/usr/bin/env node
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import ignore from 'ignore';
import { buildIgnoredMatcher } from '../src/shared/fs/ignore.js';

const root = path.join(os.tmpdir(), 'poc-ignore-matcher');
const ignoreMatcher = ignore().add(['ignored/', 'only.txt']);
const isIgnored = buildIgnoredMatcher({ root, ignoreMatcher });

const dirStats = { isDirectory: () => true };
const fileStats = { isDirectory: () => false };

const ignoredDir = path.join(root, 'ignored');
const ignoredFile = path.join(root, 'ignored', 'nested.js');
const loneFile = path.join(root, 'only.txt');

assert.equal(isIgnored(ignoredDir, dirStats), true, 'expected ignored directory to be skipped');
assert.equal(isIgnored(ignoredFile, fileStats), true, 'expected nested file under ignored dir to be skipped');
assert.equal(isIgnored(loneFile, fileStats), true, 'expected explicit file ignore to match');
const unrelatedFile = path.join(root, 'other.txt');
assert.equal(isIgnored(unrelatedFile, fileStats), false, 'expected unrelated file to be allowed');

if (path.sep === '\\') {
  const windowsPath = ignoredFile.replace(/\//g, '\\');
  assert.equal(isIgnored(windowsPath, fileStats), true, 'expected windows-style paths to normalize');
}

console.log('ignore matcher test passed');
