#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { preprocessFiles } from '../../../src/index/build/preprocess.js';
import { buildGeneratedPolicyConfig } from '../../../src/index/build/generated-policy.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'generated-policy-records-preprocess');
const recordsDir = path.join(tempRoot, 'generated', 'records');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(recordsDir, { recursive: true });
await fs.mkdir(path.join(tempRoot, 'generated', 'src'), { recursive: true });
await fs.writeFile(path.join(recordsDir, 'record.json'), '{"id":"r-1"}\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'generated', 'events.log'), '2026-01-01 00:00:00 event\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'generated', 'src', 'auto.ts'), 'export const v = 1;\n', 'utf8');

const generatedPolicy = buildGeneratedPolicyConfig({});
const { ignoreMatcher } = await buildIgnoreMatcher({
  root: tempRoot,
  userConfig: {},
  generatedPolicy
});

const result = await preprocessFiles({
  root: tempRoot,
  modes: ['records'],
  recordsDir,
  recordsConfig: null,
  ignoreMatcher,
  generatedPolicy,
  maxFileBytes: null,
  concurrency: 2
});

const recordsEntries = result.entriesByMode.records || [];
assert.deepEqual(
  recordsEntries.map((entry) => entry.rel).sort(),
  ['generated/events.log', 'generated/records/record.json'],
  'records candidates should bypass generated-policy downgrades'
);
const generatedSkip = (result.skippedByMode.records || []).find((entry) => (
  path.relative(tempRoot, entry.file || '').replace(/\\/g, '/') === 'generated/records/record.json'
  && entry.reason === 'generated'
));
assert.equal(generatedSkip, undefined, 'records-root files must not be skipped as generated');
const generatedLogSkip = (result.skippedByMode.records || []).find((entry) => (
  path.relative(tempRoot, entry.file || '').replace(/\\/g, '/') === 'generated/events.log'
  && entry.reason === 'generated'
));
assert.equal(generatedLogSkip, undefined, 'record-extension files must not be skipped as generated');

console.log('generated policy records-root preprocess bypass test passed');
