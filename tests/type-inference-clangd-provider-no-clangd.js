#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClangdProvider } from '../src/index/tooling/clangd-provider.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'clangd-provider-no-clangd');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(
  path.join(srcDir, 'sample.c'),
  'int add(int a, int b) { return a + b; }\n'
);

const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.c#seg:stub.c';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'c',
  effectiveExt: '.c'
}];
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid: 'ck64:v1:test:src/sample.c:deadbeef',
    chunkId: 'chunk_deadbeef',
    file: 'src/sample.c',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'add', kind: 'function' }
}];

const logs = [];
const log = (evt) => {
  if (!evt) return;
  logs.push(typeof evt === 'string' ? evt : (evt.message || String(evt)));
};

const provider = createClangdProvider();
const result = await provider.run({
  repoRoot,
  buildRoot: repoRoot,
  toolingConfig: {
    clangd: { requireCompilationDatabase: true }
  },
  strict: true,
  logger: log
}, { documents, targets });

if (!result || !result.byChunkUid || typeof result.byChunkUid !== 'object') {
  console.error('clangd provider did not return a byChunkUid map.');
  process.exit(1);
}

if (Object.keys(result.byChunkUid).length !== 0) {
  console.error('clangd provider should return empty map when compile_commands.json is missing.');
  process.exit(1);
}

if (!logs.some((entry) => entry.includes('compile_commands'))) {
  console.error('clangd provider missing expected compile_commands log message.');
  process.exit(1);
}

console.log('clangd provider fallback test passed');
