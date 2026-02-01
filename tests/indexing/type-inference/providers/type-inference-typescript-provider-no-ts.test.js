#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTypeScriptProvider } from '../../../../src/index/tooling/typescript-provider.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'typescript-provider-no-ts');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(
  path.join(srcDir, 'sample.ts'),
  'export function greet(name: string) { return `hi ${name}`; }\n'
);

const docText = 'export function greet(name: string) { return `hi ${name}`; }\n';
const virtualPath = '.poc-vfs/src/sample.ts#seg:stub.ts';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'typescript',
  effectiveExt: '.ts'
}];
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid: 'ck64:v1:test:src/sample.ts:deadbeef',
    chunkId: 'chunk_deadbeef',
    file: 'src/sample.ts',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'greet', kind: 'function' }
}];

const logs = [];
const log = (evt) => {
  if (!evt) return;
  logs.push(typeof evt === 'string' ? evt : (evt.message || String(evt)));
};
const toolingConfig = {
  dir: path.join(repoRoot, '.tooling'),
  typescript: {
    enabled: true,
    resolveOrder: ['cache'],
    useTsconfig: true
  }
};

const provider = createTypeScriptProvider();
const result = await provider.run({
  repoRoot,
  buildRoot: repoRoot,
  toolingConfig,
  strict: true,
  logger: log
}, { documents, targets });

if (!result || !result.byChunkUid || typeof result.byChunkUid !== 'object') {
  console.error('TypeScript provider did not return a byChunkUid map.');
  process.exit(1);
}

if (Object.keys(result.byChunkUid).length !== 0) {
  console.error('TypeScript provider should return empty map when module is missing.');
  process.exit(1);
}

if (!logs.some((entry) => entry.includes('TypeScript tooling not detected'))) {
  console.error('TypeScript provider missing expected fallback log message.');
  process.exit(1);
}

console.log('TypeScript provider fallback test passed');
