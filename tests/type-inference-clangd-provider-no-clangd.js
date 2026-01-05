#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectClangdTypes } from '../src/index/tooling/clangd-provider.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'clangd-provider-no-clangd');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(
  path.join(srcDir, 'sample.c'),
  'int add(int a, int b) { return a + b; }\n'
);

const chunksByFile = new Map([
  ['src/sample.c', [{ file: 'src/sample.c', name: 'add', start: 0, end: 10, docmeta: {} }]]
]);

const logs = [];
const log = (msg) => logs.push(String(msg));

const result = await collectClangdTypes({
  rootDir: repoRoot,
  chunksByFile,
  log,
  cmd: 'clangd-does-not-exist'
});

if (!result || !(result.typesByChunk instanceof Map)) {
  console.error('clangd provider did not return a types map.');
  process.exit(1);
}

if (result.typesByChunk.size !== 0) {
  console.error('clangd provider should return empty map when clangd is missing.');
  process.exit(1);
}

if (!logs.some((entry) => entry.includes('clangd not detected'))) {
  console.error('clangd provider missing expected fallback log message.');
  process.exit(1);
}

console.log('clangd provider fallback test passed');
