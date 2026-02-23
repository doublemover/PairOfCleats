#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadDictionary } from '../../../src/retrieval/cli-dictionary.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cli-dict-summary-'));
const dictDir = path.join(tempRoot, 'dicts');
const codeDictDir = path.join(dictDir, 'code-dicts');
await fs.mkdir(codeDictDir, { recursive: true });

const combinedPath = path.join(dictDir, 'combined.txt');
const customCodeDictPath = path.join(codeDictDir, 'foobar.txt');
await fs.writeFile(combinedPath, 'alpha\n', 'utf8');
await fs.writeFile(customCodeDictPath, '', 'utf8');

const dictConfig = {
  dir: dictDir,
  languages: [],
  files: [],
  includeSlang: false,
  slangDirs: [],
  slangFiles: [],
  enableRepoDictionary: false
};

try {
  const loaded = await loadDictionary(tempRoot, dictConfig, {
    includeCode: true,
    codeDictLanguages: ['foobar']
  });
  assert.deepEqual(
    loaded.codeDictSummary?.languages,
    ['foobar'],
    'expected code dictionary summary to report configured/discovered languages even when files are empty'
  );
  assert.equal(loaded.codeDictionaryPaths?.byLanguage?.has('foobar'), true);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('cli dictionary summary test passed');
