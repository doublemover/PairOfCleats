#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getBodySummary, getBodySummaryResult } from '../../../src/retrieval/output/summary.js';
import { withVirtualReparsePath } from '../../helpers/virtual-reparse-path.js';

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

// Exercise the actual no-follow owner with virtual reparse metadata. This makes
// the negative mandatory without creating links or pretending to qualify native
// Windows reparse resolution. Real in-root/outside-root inputs above remain.
withVirtualReparsePath({ file: path.join(repoRoot, 'linked-outside.txt'), statSource: outsideFile }, observations => {
  const result = getBodySummaryResult(repoRoot, { file: 'linked-outside.txt', start: 0, end: 80 }, 10);
  assert.equal(
    result.text,
    '(Could not load summary)',
    'expected symlinked outside file summary reads to be blocked'
  );
  assert.equal(result.errorCode, 'ERR_UNSAFE_FILE_PATH', 'absence is not a reparse refusal');
  assert.ok(observations.inspected > 0, 'the real no-follow boundary must inspect the reparse metadata');
  assert.equal(observations.opened, 0, 'a reparse refusal must precede source open/read');
});

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('summary path safety test passed');
