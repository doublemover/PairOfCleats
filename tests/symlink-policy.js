#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';
import { discoverEntries } from '../src/index/build/discover.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'symlink-policy');
const repoRoot = path.join(tempRoot, 'repo');
const outsideRoot = path.join(tempRoot, 'outside');
const insideTarget = path.join(repoRoot, 'inside.txt');
const outsideTarget = path.join(outsideRoot, 'outside.txt');
const linkInside = path.join(repoRoot, 'link-inside.txt');
const linkOutside = path.join(repoRoot, 'link-outside.txt');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(outsideRoot, { recursive: true });
await fs.writeFile(insideTarget, 'inside');
await fs.writeFile(outsideTarget, 'outside');

const createSymlink = async (target, link) => {
  try {
    await fs.symlink(target, link, 'file');
    return true;
  } catch (err) {
    if (['EPERM', 'EACCES', 'EINVAL'].includes(err?.code)) {
      console.log('Symlink creation not permitted; skipping test.');
      return false;
    }
    throw err;
  }
};

const insideOk = await createSymlink(insideTarget, linkInside);
if (!insideOk) process.exit(0);
const outsideOk = await createSymlink(outsideTarget, linkOutside);
if (!outsideOk) process.exit(0);

const ignoreMatcher = ignore();
const baseArgs = {
  root: repoRoot,
  ignoreMatcher,
  maxFileBytes: null,
  fileCaps: null,
  maxDepth: null,
  maxFiles: null
};

const { entries: defaultEntries, skippedCommon: defaultSkipped } = await discoverEntries(baseArgs);
assert.ok(defaultEntries.some((entry) => entry.rel === 'inside.txt'));
assert.ok(!defaultEntries.some((entry) => entry.rel === 'link-inside.txt'));
assert.ok(defaultSkipped.some((skip) => skip.reason === 'symlink' && skip.file.endsWith('link-inside.txt')));

const { entries: allowedEntries, skippedCommon: allowedSkipped } = await discoverEntries({
  ...baseArgs,
  symlinkPolicy: { mode: 'within-root', rootDir: repoRoot }
});
const linkEntry = allowedEntries.find((entry) => entry.rel === 'link-inside.txt');
assert.ok(linkEntry && linkEntry.symlink === true && linkEntry.readPath);
assert.equal(path.resolve(linkEntry.readPath), path.resolve(insideTarget));
assert.ok(!allowedEntries.some((entry) => entry.rel === 'link-outside.txt'));
assert.ok(allowedSkipped.some((skip) => skip.reason === 'symlink-outside-root' && skip.file.endsWith('link-outside.txt')));

console.log('symlink policy test passed');
