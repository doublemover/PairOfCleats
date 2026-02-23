#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getBodySummary } from '../../../src/retrieval/output/summary.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-summary-path-safety-'));
const repoRoot = path.join(tempRoot, 'repo');
const outsideRoot = path.join(tempRoot, 'outside');
await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(outsideRoot, { recursive: true });

const localFile = path.join(repoRoot, 'in-root.txt');
await fs.writeFile(localFile, 'alpha beta gamma delta', 'utf8');
const localSummary = getBodySummary(repoRoot, { file: 'in-root.txt', start: 0, end: 22 }, 3);
assert.equal(localSummary, 'alpha beta gamma', 'expected in-root summary extraction to work');

const dotDotPrefixedFile = path.join(repoRoot, '..notes.txt');
await fs.writeFile(dotDotPrefixedFile, 'inside dotdot prefix file works', 'utf8');
const dotDotSummary = getBodySummary(repoRoot, { file: '..notes.txt', start: 0, end: 32 }, 4);
assert.equal(
  dotDotSummary,
  'inside dotdot prefix file',
  'expected in-root ..-prefixed segment summary extraction to work'
);

const outsideFile = path.join(outsideRoot, 'outside.txt');
await fs.writeFile(outsideFile, 'outside content should never be read', 'utf8');
const linkedFile = path.join(repoRoot, 'linked-outside.txt');

let symlinkCreated = false;
try {
  if (process.platform === 'win32') {
    await fs.symlink(outsideFile, linkedFile, 'file');
  } else {
    await fs.symlink(outsideFile, linkedFile);
  }
  symlinkCreated = true;
} catch {}

if (symlinkCreated) {
  const escapedSummary = getBodySummary(repoRoot, { file: 'linked-outside.txt', start: 0, end: 80 }, 10);
  assert.equal(
    escapedSummary,
    '(Could not load summary)',
    'expected symlinked outside file summary reads to be blocked'
  );
}

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('summary path safety test passed');
