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

const chunkUid = 'ck64:v1:test:src/dups.ts:ambiguous';
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid,
    chunkId: 'chunk_ambiguous',
    file: 'src/dups.ts',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'dup', kind: 'method' }
}];

const provider = createTypeScriptProvider();
const result = await provider.run({
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {
    typescript: { allowJs: true, checkJs: true, includeJsx: true, useTsconfig: false }
  },
  strict: false,
  logger: () => {}
}, { documents, targets });

assert.ok(!result.byChunkUid?.[chunkUid], 'expected ambiguous fallback to avoid guessing');

console.log('TypeScript ambiguous fallback test passed');
