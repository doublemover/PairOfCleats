import assert from 'node:assert/strict';
import { buildJsChunks } from '../../src/lang/javascript/chunks.js';
import { buildCodeRelations } from '../../src/lang/javascript/relations.js';
import { buildCallIndex } from '../../src/index/build/file-processor/relations.js';
import { retainModuleCallChunks } from '../../src/index/build/file-processor/cpu/chunking.js';
import { attachCallDetailsByChunkIndex } from '../../src/index/build/file-processor/process-chunks/dedupe.js';
import { buildChunkRelations } from '../../src/index/language-registry/registry.js';

const text = 'first(1);\nexport function owner() { nested(2); }\nlast(3); final(4);';
const declarations = buildJsChunks(text);
assert.equal(declarations.length, 1);
const original = structuredClone(declarations);
const relations = buildCodeRelations(text, 'module.js');
const index = buildCallIndex(relations);
const chunks = retainModuleCallChunks({ chunks: declarations, callIndex: index, languageId: 'javascript', textLength: text.length });
assert.deepEqual(declarations, original, 'parser-owned declaration ranges remain unchanged');
assert.equal(chunks.length, 3);
assert.deepEqual(chunks.filter(chunk => chunk.name === '(module)').map(chunk => text.slice(chunk.start, chunk.end)),
  ['first(1)', 'last(3); final(4)']);
attachCallDetailsByChunkIndex(index, chunks);
const projected = chunks.flatMap((chunk, chunkIndex) => (buildChunkRelations({ lang: { id: 'javascript' }, chunk,
  fileRelations: relations, callIndex: index, chunkIndex }).callDetails || []).map(detail => [chunk.name, detail.callee]));
assert.deepEqual(projected, [['(module)', 'first'], ['owner', 'nested'], ['(module)', 'last'], ['(module)', 'final']]);
assert.equal(new Set(projected.map(row => row[1])).size, 4, 'every original call has exactly one source owner');
assert.equal(retainModuleCallChunks({ chunks, callIndex: index, languageId: 'javascript', textLength: text.length }), chunks,
  'replayed parse checkpoints do not add duplicate module owners');
assert.equal(retainModuleCallChunks({ chunks: declarations, callIndex: index, languageId: 'python', textLength: text.length }), declarations);
const crossing = { callDetailsWithRange: [{ caller: '(module)', start: 0, end: text.length }] };
assert.equal(retainModuleCallChunks({ chunks: declarations, callIndex: crossing, languageId: 'javascript', textLength: text.length }), declarations,
  'a crossing call cannot borrow a declaration range');
console.log('Parser module calls retain exact gap ownership without duplicate or neighboring declaration authority.');
