#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectSourcekitTypes } from '../src/indexer/tooling/sourcekit-provider.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'sourcekit-provider-no-sourcekit');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(
  path.join(srcDir, 'sample.swift'),
  'func greet(name: String) -> String { return "hi \\(name)" }\n'
);

const chunksByFile = new Map([
  ['src/sample.swift', [{ file: 'src/sample.swift', name: 'greet', start: 0, end: 10, docmeta: {} }]]
]);

const logs = [];
const log = (msg) => logs.push(String(msg));

const result = await collectSourcekitTypes({
  rootDir: repoRoot,
  chunksByFile,
  log,
  cmd: 'sourcekit-lsp-does-not-exist'
});

if (!result || !(result.typesByChunk instanceof Map)) {
  console.error('sourcekit provider did not return a types map.');
  process.exit(1);
}

if (result.typesByChunk.size !== 0) {
  console.error('sourcekit provider should return empty map when sourcekit-lsp is missing.');
  process.exit(1);
}

if (!logs.some((entry) => entry.includes('sourcekit-lsp not detected'))) {
  console.error('sourcekit provider missing expected fallback log message.');
  process.exit(1);
}

console.log('sourcekit provider fallback test passed');
