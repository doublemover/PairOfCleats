#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveRuntimeDictionaries } from '../../../src/index/build/runtime/dictionaries.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-runtime-code-dicts-'));
const dictDir = path.join(tempRoot, 'dicts');
const jsDir = path.join(dictDir, 'code-dicts', 'javascript');
const tsDir = path.join(dictDir, 'code-dicts', 'typescript');

try {
  await fs.mkdir(jsDir, { recursive: true });
  await fs.mkdir(tsDir, { recursive: true });
  await fs.writeFile(path.join(jsDir, 'js.txt'), 'fetch\npromise\n', 'utf8');
  await fs.writeFile(path.join(tsDir, 'ts.txt'), 'interface\ntype\n', 'utf8');

  const runtimeDicts = await resolveRuntimeDictionaries({
    root: tempRoot,
    userConfig: {
      dictionary: { dir: dictDir },
      indexing: { codeDictLanguages: ['javascript'] }
    },
    workerPoolConfig: { enabled: false },
    daemonSession: null,
    log: () => {},
    logInit: () => {}
  });

  assert.equal(runtimeDicts.codeDictLanguages.has('javascript'), true, 'expected javascript to be selected');
  assert.equal(runtimeDicts.codeDictLanguages.has('typescript'), false, 'expected typescript to be excluded by override');
  assert.equal(runtimeDicts.codeDictPaths.byLanguage.has('javascript'), true, 'expected javascript dictionary paths to load');
  assert.equal(runtimeDicts.codeDictPaths.byLanguage.has('typescript'), false, 'expected typescript dictionary paths to be filtered out');

  console.log('runtime dictionaries code language selection test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
