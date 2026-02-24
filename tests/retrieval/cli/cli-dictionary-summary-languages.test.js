#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadDictionary } from '../../../src/retrieval/cli-dictionary.js';

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cli-dict-summary-'));
const dictDir = path.join(tmpRoot, 'dict');

try {
  const jsDir = path.join(dictDir, 'code-dicts', 'javascript');
  const pyDir = path.join(dictDir, 'code-dicts', 'python');
  await fs.mkdir(jsDir, { recursive: true });
  await fs.mkdir(pyDir, { recursive: true });

  await fs.writeFile(path.join(jsDir, 'empty.txt'), '\n \n', 'utf8');
  await fs.writeFile(path.join(pyDir, 'words.txt'), 'Alpha\nBeta\n', 'utf8');

  const dictConfig = {
    dir: dictDir,
    languages: [],
    files: [],
    includeSlang: false,
    slangDirs: [],
    slangFiles: [],
    enableRepoDictionary: false
  };

  const result = await loadDictionary(tmpRoot, dictConfig, {
    includeCode: true,
    codeDictLanguages: ['javascript', 'python']
  });

  assert.deepEqual(
    result.codeDictSummary.languages,
    ['javascript', 'python'],
    'expected summary to report configured/discovered languages even when one file is empty'
  );
  assert.ok(
    result.codeDictSummary.words >= 2,
    'expected code dictionary summary to include loaded words'
  );
  assert.equal(result.codeDictionaryPaths.byLanguage.has('javascript'), true);
  assert.equal(result.codeDictionaryPaths.byLanguage.has('python'), true);

  console.log('cli dictionary summary languages test passed');
} finally {
  await fs.rm(tmpRoot, { recursive: true, force: true });
}
