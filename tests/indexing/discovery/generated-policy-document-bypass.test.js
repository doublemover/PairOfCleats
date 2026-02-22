#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildGeneratedPolicyConfig } from '../../../src/index/build/generated-policy.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'generated-policy-document-bypass');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'docs', 'report.min.pdf'), '%PDF-1.4\n', 'utf8');

const generatedPolicy = buildGeneratedPolicyConfig({});
const { ignoreMatcher } = await buildIgnoreMatcher({
  root: tempRoot,
  userConfig: {},
  generatedPolicy
});

const skippedFiles = [];
const entries = await discoverFiles({
  root: tempRoot,
  mode: 'extracted-prose',
  documentExtractionConfig: { enabled: true },
  ignoreMatcher,
  generatedPolicy,
  skippedFiles,
  maxFileBytes: null
});

assert.deepEqual(
  entries.map((entry) => entry.rel).sort(),
  ['docs/report.min.pdf'],
  'minified-name document files should remain discoverable for extracted-prose mode'
);
const minifiedSkip = skippedFiles.find((entry) => (
  path.relative(tempRoot, entry.file).replace(/\\/g, '/') === 'docs/report.min.pdf'
));
assert.equal(minifiedSkip, undefined, 'document should not be downgraded by minified-name policy');

console.log('generated policy document bypass discovery test passed');
