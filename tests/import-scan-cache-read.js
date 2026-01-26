#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../src/index/build/imports.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'import-scan-cache-read');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });

const files = [];
for (const name of ['a.js', 'b.js']) {
  const filePath = path.join(srcRoot, name);
  await fs.writeFile(filePath, 'export const value = 1;\n');
  const stat = await fs.stat(filePath);
  files.push({ abs: filePath, rel: `src/${name}`, stat });
}

let calls = 0;
const readCachedImportsFn = async () => {
  calls += 1;
  return null;
};

await scanImports({
  files,
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1,
  incrementalState: {
    enabled: true,
    manifest: { files: {} },
    bundleDir: tempRoot,
    bundleFormat: 'json'
  },
  readCachedImportsFn
});

assert.equal(calls, files.length, 'expected one cached import read per file');

console.log('import scan cache read test passed');

