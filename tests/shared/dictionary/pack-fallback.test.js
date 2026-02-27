#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getCodeDictionaryPaths } from '../../../tools/dict-utils/paths/dictionaries.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-dict-pack-'));
const dictConfig = {
  dir: tempRoot,
  languages: [],
  files: [],
  includeSlang: false,
  slangDirs: [],
  slangFiles: [],
  enableRepoDictionary: false
};

const paths = await getCodeDictionaryPaths(process.cwd(), dictConfig, {
  languages: ['typescript'],
  useBundledFallback: true
});

assert.equal(typeof paths.bundleProfileVersion, 'string', 'expected bundled dictionary profile version');
assert.ok(paths.bundleProfileVersion.length > 0, 'expected non-empty bundled profile version');
assert.equal(paths.byLanguage.has('typescript'), true, 'expected bundled typescript dictionary');
const tsFiles = paths.byLanguage.get('typescript') || [];
assert.ok(tsFiles.length >= 1, 'expected at least one bundled typescript dictionary file');

for (const filePath of tsFiles) {
  const stat = await fs.stat(filePath);
  assert.equal(stat.isFile(), true, `expected dictionary file at ${filePath}`);
}

console.log('dictionary pack fallback test passed');
