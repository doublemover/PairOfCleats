#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createTypeScriptProvider } from '../../../../src/index/tooling/typescript-provider.js';

const docText = 'function f({ a, b }, [c]) { return a + c; }\n';
const virtualPath = '.poc-vfs/src/destructure.ts#seg:stub.ts';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'typescript',
  effectiveExt: '.ts'
}];

const start = docText.indexOf('function f');
const end = docText.length;
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid: 'ck64:v1:test:src/destructure.ts:one',
    chunkId: 'chunk_one',
    file: 'src/destructure.ts',
    segmentUid: null,
    segmentId: null,
    range: { start, end }
  },
  virtualPath,
  virtualRange: { start, end },
  symbolHint: { name: 'f', kind: 'function' }
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

const entry = result.byChunkUid?.[targets[0].chunkRef.chunkUid];
assert.ok(entry, 'expected tooling entry');
const paramTypes = entry.payload?.paramTypes || {};
assert.ok(paramTypes['{a,b}'], 'expected normalized object pattern param name');
assert.ok(paramTypes['[c]'], 'expected normalized array pattern param name');

console.log('TypeScript destructured param name test passed');
