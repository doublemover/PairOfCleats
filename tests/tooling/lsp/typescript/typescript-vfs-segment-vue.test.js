#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createTypeScriptProvider } from '../../../../src/index/tooling/typescript-provider.js';

const docText = 'export function greet(name: string) { return name; }\n';
const virtualPath = '.poc-vfs/src/App.vue#seg:stub.ts';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'typescript',
  effectiveExt: '.ts'
}];

const chunkUid = 'ck64:v1:test:src/App.vue:deadbeef';
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid,
    chunkId: 'chunk_deadbeef',
    file: 'src/App.vue',
    segmentUid: 'seg-stub',
    segmentId: 'seg-stub',
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'greet', kind: 'function' }
}];

const provider = createTypeScriptProvider();
const result = await provider.run({
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {
    typescript: { allowJs: true, checkJs: true, includeJsx: true, useTsconfig: false }
  },
  strict: true,
  logger: () => {}
}, { documents, targets });

const entry = result.byChunkUid?.[chunkUid];
assert.ok(entry, 'expected TypeScript provider to return an entry for VFS target');
assert.equal(entry.payload.returnType, 'string');

console.log('TypeScript VFS segment test passed');
