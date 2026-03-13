#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ignore-optional-'));

const withoutDefaultFiles = await buildIgnoreMatcher({
  root: tempRoot,
  userConfig: {
    useGitignore: true,
    usePairofcleatsIgnore: true
  }
});
assert.equal(
  withoutDefaultFiles.warnings.some((warning) => warning.type === 'read-failed'),
  false,
  'missing optional default ignore files should not emit read-failed warnings'
);

const explicitMissing = await buildIgnoreMatcher({
  root: tempRoot,
  userConfig: {
    ignoreFiles: ['missing.ignore']
  }
});
assert.equal(
  explicitMissing.warnings.some((warning) => warning.type === 'read-failed' && warning.file === 'missing.ignore'),
  true,
  'missing explicit ignore files should continue to emit read-failed warnings'
);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('ignore optional defaults test passed');
