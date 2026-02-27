#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createTypeScriptProvider } from '../../../../src/index/tooling/typescript-provider.js';

const docText = 'function sink(toString: string, constructor: number, __proto__: boolean) { return toString; }\n';
const virtualPath = '.poc-vfs/src/prototype-params.ts#seg:stub.ts';
const documents = [{
  virtualPath,
  text: docText,
  languageId: 'typescript',
  effectiveExt: '.ts'
}];

const start = docText.indexOf('function sink');
const end = docText.length;
const targets = [{
  chunkRef: {
    docId: 0,
    chunkUid: 'ck64:v1:test:src/prototype-params.ts:one',
    chunkId: 'chunk_prototype_params',
    file: 'src/prototype-params.ts',
    segmentUid: null,
    segmentId: null,
    range: { start, end }
  },
  virtualPath,
  virtualRange: { start, end },
  symbolHint: { name: 'sink', kind: 'function' }
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
const paramTypes = entry.payload?.paramTypes;
assert.ok(paramTypes && typeof paramTypes === 'object', 'expected paramTypes object');
assert.equal(Object.getPrototypeOf(paramTypes), null, 'expected paramTypes map to be null-prototype');

for (const key of ['toString', 'constructor', '__proto__']) {
  assert.equal(Object.hasOwn(paramTypes, key), true, `expected paramTypes to include key ${key}`);
  assert.ok(Array.isArray(paramTypes[key]), `expected paramTypes.${key} to be an array`);
  assert.ok(paramTypes[key].length > 0, `expected paramTypes.${key} to include inferred entries`);
}

assert.equal(paramTypes.toString[0]?.type, 'string');
assert.equal(paramTypes.constructor[0]?.type, 'number');
assert.equal(paramTypes.__proto__[0]?.type, 'boolean');

console.log('TypeScript prototype param names test passed');
