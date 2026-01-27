#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createTypeScriptProvider } from '../../src/index/tooling/typescript-provider.js';

const docText = [
  '/** @param {number} a @returns {number} */',
  'function add(a) { return a + 1; }',
  ''
].join('\n');
const virtualPath = '.poc-vfs/src/sample.js#seg:stub.js';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'javascript',
  effectiveExt: '.js'
}];

const chunkUid = 'ck64:v1:test:src/sample.js:deadbeef';
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid,
    chunkId: 'chunk_deadbeef',
    file: 'src/sample.js',
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'add', kind: 'function' }
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
assert.ok(entry, 'expected TypeScript provider to return an entry for JS target');
assert.equal(entry.payload.returnType, 'number');

console.log('TypeScript JS parity test passed');
