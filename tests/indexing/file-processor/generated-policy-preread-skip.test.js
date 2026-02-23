#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { resolvePreReadSkip } from '../../../src/index/build/file-processor/skip.js';
import { buildGeneratedPolicyConfig, GENERATED_POLICY_REASON_CODE } from '../../../src/index/build/generated-policy.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'generated-policy-preread');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src', 'generated', 'full', 'force-metadata'), { recursive: true });

const includedPath = path.join(tempRoot, 'src', 'generated', 'full', 'keep.min.js');
const excludedPath = path.join(tempRoot, 'src', 'generated', 'full', 'force-metadata', 'keep.min.js');
await fs.writeFile(includedPath, 'export const keep = 1;\n', 'utf8');
await fs.writeFile(excludedPath, 'export const force = 1;\n', 'utf8');

const includePolicy = buildGeneratedPolicyConfig({
  generatedPolicy: {
    include: ['src/generated/full/**'],
    exclude: ['src/generated/full/force-metadata/**']
  }
});

const includeStat = await fs.stat(includedPath);
const includeSkip = await resolvePreReadSkip({
  abs: includedPath,
  rel: 'src/generated/full/keep.min.js',
  fileEntry: null,
  fileStat: includeStat,
  ext: '.js',
  fileCaps: null,
  fileScanner: {
    scanFile: async () => ({
      checkedBinary: true,
      checkedMinified: true,
      skip: { reason: 'minified', method: 'content' }
    }),
    binary: { maxNonTextRatio: 0.3 }
  },
  runIo: async (fn) => fn(),
  generatedPolicy: includePolicy
});
assert.equal(includeSkip, null, 'include policy should bypass minified downgrade');

const excludeStat = await fs.stat(excludedPath);
const excludeSkip = await resolvePreReadSkip({
  abs: excludedPath,
  rel: 'src/generated/full/force-metadata/keep.min.js',
  fileEntry: null,
  fileStat: excludeStat,
  ext: '.js',
  fileCaps: null,
  fileScanner: {
    scanFile: async () => ({
      checkedBinary: true,
      checkedMinified: true,
      skip: { reason: 'minified', method: 'content' }
    }),
    binary: { maxNonTextRatio: 0.3 }
  },
  runIo: async (fn) => fn(),
  generatedPolicy: includePolicy
});
assert.equal(excludeSkip?.reason, 'minified', 'exclude policy should force metadata-only downgrade');
assert.equal(excludeSkip?.downgrade?.reasonCode, GENERATED_POLICY_REASON_CODE);
assert.equal(excludeSkip?.indexMode, 'metadata-only');
assert.equal(excludeSkip?.downgrade?.policy, 'exclude');

const recordsMinifiedPath = path.join(tempRoot, 'src', 'generated', 'full', 'record.min.json');
await fs.writeFile(recordsMinifiedPath, '{"id":"r-1"}\n', 'utf8');
const recordsMinifiedStat = await fs.stat(recordsMinifiedPath);
const recordsMinifiedSkip = await resolvePreReadSkip({
  abs: recordsMinifiedPath,
  rel: 'src/generated/full/record.min.json',
  fileEntry: { record: { source: 'triage', recordType: 'record' } },
  fileStat: recordsMinifiedStat,
  ext: '.json',
  mode: 'records',
  fileCaps: null,
  fileScanner: {
    scanFile: async () => ({
      checkedBinary: true,
      checkedMinified: true,
      skip: null
    }),
    binary: { maxNonTextRatio: 0.3 }
  },
  runIo: async (fn) => fn(),
  generatedPolicy: includePolicy
});
assert.equal(recordsMinifiedSkip, null, 'records entries should not be dropped by minified filename checks');

console.log('generated policy pre-read skip test passed');
