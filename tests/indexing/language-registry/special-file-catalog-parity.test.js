#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  CODE_FILENAMES,
  LOCK_FILES,
  MANIFEST_FILES,
  isManifestFile,
  resolveSpecialCodeExt
} from '../../../src/index/constants.js';
import {
  LOCK_FILENAMES,
  MANIFEST_FILENAMES,
  MANIFEST_SUFFIXES,
  SPECIAL_CODE_FILENAMES,
  SPECIAL_CODE_FILENAME_TO_EXT
} from '../../../src/index/language-registry/special-files.js';

applyTestEnv();

const sorted = (setLike) => Array.from(setLike).sort();

assert.deepEqual(
  sorted(MANIFEST_FILES),
  sorted(MANIFEST_FILENAMES),
  'manifest constants should be generated from canonical special-files catalog'
);

assert.deepEqual(
  sorted(LOCK_FILES),
  sorted(LOCK_FILENAMES),
  'lock constants should be generated from canonical special-files catalog'
);

assert.deepEqual(
  sorted(CODE_FILENAMES),
  sorted(SPECIAL_CODE_FILENAMES),
  'special code filename constants should be generated from canonical special-files catalog'
);

const requiredManifestCoverage = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'cargo.toml',
  'pubspec.yaml',
  'pom.xml'
];
for (const entry of requiredManifestCoverage) {
  assert.equal(MANIFEST_FILES.has(entry), true, `missing manifest catalog entry: ${entry}`);
}

for (const suffix of MANIFEST_SUFFIXES) {
  const sample = `sample${suffix}`;
  assert.equal(isManifestFile(sample), true, `manifest suffix should route as manifest: ${suffix}`);
}

const requiredLockCoverage = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'pipfile.lock',
  'poetry.lock',
  'cargo.lock',
  'go.sum'
];
for (const entry of requiredLockCoverage) {
  assert.equal(LOCK_FILES.has(entry), true, `missing lock catalog entry: ${entry}`);
}

for (const [name, ext] of Object.entries(SPECIAL_CODE_FILENAME_TO_EXT)) {
  assert.equal(resolveSpecialCodeExt(name), ext, `special file ext mapping mismatch for ${name}`);
}

console.log('special file catalog parity test passed');
