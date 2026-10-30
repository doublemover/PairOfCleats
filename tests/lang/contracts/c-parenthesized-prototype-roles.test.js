import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const options = { treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false },
  astDataflowEnabled: false, controlFlowEnabled: false };
const c = [
  'int (wrapped)(int);',
  'int ((deep))(int);',
  'int (*factory(void))(int);',
  'int (*callback)(int);',
  'typedef int (*Handler)(int);',
  'void takes(int (*parameter_callback)(int));',
  'struct Holder { int (*field_callback)(int); };',
  'int body(int value) { return value; }',
  ''
].join('\n');
const prepared = await buildLanguageContext({ ext: '.c', relPath: 'prototypes.c', mode: 'code', text: c, options });
const chunks = prepared.context.clikeChunks;
for (const [name, source] of [
  ['wrapped', 'int (wrapped)(int);'],
  ['deep', 'int ((deep))(int);'],
  ['factory', 'int (*factory(void))(int);'],
  ['takes', 'void takes(int (*parameter_callback)(int));']
]) {
  const matches = chunks.filter(chunk => chunk.name === name && chunk.kind === 'FunctionDeclaration');
  assert.equal(matches.length, 1, `${name} is one callable declaration`);
  assert.equal(c.slice(matches[0].start, matches[0].end), source, 'prototype keeps the complete enclosing declaration');
  assert.equal(matches[0].meta.bodyless, true);
  assert.equal(matches[0].meta.signature, source);
}
for (const name of ['callback', 'Handler', 'parameter_callback', 'field_callback']) {
  assert.equal(chunks.some(chunk => chunk.name === name && /Function|Method/u.test(chunk.kind)), false,
    `${name}: a pointer binding or function type is not a function prototype`);
}
assert.equal(chunks.filter(chunk => chunk.name === 'body').length, 1, 'function definitions remain single declarations');
assert.equal(chunks.find(chunk => chunk.name === 'body').meta.bodyless, undefined);

const cpp = [
  'namespace api {',
  'int (wrapped)(int);',
  'class Box { public: int (member)(int); int (*callback)(int); };',
  '}',
  ''
].join('\n');
const cppPrepared = await buildLanguageContext({ ext: '.cpp', relPath: 'prototypes.cpp', mode: 'code', text: cpp, options });
const cppChunks = cppPrepared.context.clikeChunks;
assert.equal(cppChunks.filter(chunk => chunk.name === 'api.wrapped' && chunk.kind === 'FunctionDeclaration').length, 1);
assert.equal(cppChunks.filter(chunk => chunk.name === 'api.Box.member' && chunk.kind === 'MethodDeclaration').length, 1);
assert.equal(cppChunks.some(chunk => chunk.name === 'api.Box.callback' && /Function|Method/u.test(chunk.kind)), false);
assert.equal(cppChunks.find(chunk => chunk.name === 'api.Box.member').meta.bodyless, true);
console.log('registered C/C++ parenthesized prototype and pointer-binding roles test passed');
