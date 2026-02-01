#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createTypeScriptProvider } from '../../../../src/index/tooling/typescript-provider.js';

const docText = [
  'class A { dup() { return 1; } }',
  'class B { dup() { return "x"; } }',
  ''
].join('\n');
const virtualPath = '.poc-vfs/src/dups.ts#seg:stub.ts';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'typescript',
  effectiveExt: '.ts'
}];

const firstMethod = 'dup() { return 1; }';
const secondMethod = 'dup() { return "x"; }';
const firstStart = docText.indexOf(firstMethod);
const secondStart = docText.indexOf(secondMethod);
const targets = [
  {
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:src/dups.ts:first',
      chunkId: 'chunk_first',
      file: 'src/dups.ts',
      segmentUid: null,
      segmentId: null,
      range: { start: firstStart, end: firstStart + firstMethod.length }
    },
    virtualPath,
    virtualRange: { start: firstStart, end: firstStart + firstMethod.length },
    symbolHint: { name: 'dup', kind: 'method' }
  },
  {
    chunkRef: {
      docId: 1,
      chunkUid: 'ck64:v1:test:src/dups.ts:second',
      chunkId: 'chunk_second',
      file: 'src/dups.ts',
      segmentUid: null,
      segmentId: null,
      range: { start: secondStart, end: secondStart + secondMethod.length }
    },
    virtualPath,
    virtualRange: { start: secondStart, end: secondStart + secondMethod.length },
    symbolHint: { name: 'dup', kind: 'method' }
  }
];

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

const first = result.byChunkUid?.[targets[0].chunkRef.chunkUid];
const second = result.byChunkUid?.[targets[1].chunkRef.chunkUid];
assert.ok(first && second, 'expected both targets to resolve');
assert.equal(first.payload.returnType, 'number');
assert.equal(second.payload.returnType, 'string');

console.log('TypeScript node range matching test passed');
