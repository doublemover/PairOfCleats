#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildGeneratedPolicyConfig, GENERATED_POLICY_REASON_CODE } from '../../../src/index/build/generated-policy.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'generated-policy-discovery');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src', 'generated', 'full'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'vendor'), { recursive: true });

await fs.writeFile(path.join(tempRoot, 'src', 'app.min.js'), 'export const a = 1;\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'generated', 'auto.ts'), 'export const g = 1;\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'vendor', 'sdk.js'), 'export const v = 1;\n', 'utf8');
await fs.writeFile(path.join(tempRoot, 'src', 'generated', 'full', 'keep.min.js'), 'export const keep = 1;\n', 'utf8');

const generatedPolicy = buildGeneratedPolicyConfig({
  generatedPolicy: {
    include: ['src/generated/full/**']
  }
});
const { ignoreMatcher } = await buildIgnoreMatcher({
  root: tempRoot,
  userConfig: {},
  generatedPolicy
});
const skippedFiles = [];
const entries = await discoverFiles({
  root: tempRoot,
  mode: 'code',
  ignoreMatcher,
  generatedPolicy,
  skippedFiles,
  maxFileBytes: null
});

const relEntries = entries.map((entry) => entry.rel).sort();
assert.deepEqual(
  relEntries,
  ['src/generated/full/keep.min.js'],
  'only explicitly included generated file should survive discovery'
);

const byReason = new Map(skippedFiles.map((entry) => [path.relative(tempRoot, entry.file).replace(/\\/g, '/'), entry]));
const minifiedSkip = byReason.get('src/app.min.js');
const generatedSkip = byReason.get('src/generated/auto.ts');
const vendorSkip = byReason.get('vendor/sdk.js');

assert.equal(minifiedSkip?.reason, 'minified');
assert.equal(generatedSkip?.reason, 'generated');
assert.equal(vendorSkip?.reason, 'vendor');
assert.equal(minifiedSkip?.downgrade?.reasonCode, GENERATED_POLICY_REASON_CODE);
assert.equal(generatedSkip?.downgrade?.reasonCode, GENERATED_POLICY_REASON_CODE);
assert.equal(vendorSkip?.downgrade?.reasonCode, GENERATED_POLICY_REASON_CODE);
assert.equal(minifiedSkip?.indexMode, 'metadata-only');

console.log('generated policy discovery test passed');
