import assert from 'node:assert/strict';
import ts from 'typescript';
import { normalizeProviderPayload } from '../../../../src/index/tooling/provider-output-contract.js';
import { applyToolingTypes } from '../../../../src/index/type-inference-crossfile/tooling-types.js';
import { buildFilterIndex } from '../../../../src/retrieval/filter-index.js';
import { filterChunks } from '../../../../src/retrieval/output/filters.js';

const annotations = ['Boolean', 'boolean', 'String', 'string', 'Number', 'number',
  'Boolean | boolean', '"with space"', '"with  space"'];
const text = annotations.map((type, id) => `export function value${id}(input: ${type}): ${type} { throw new Error(); }`).join('\n');
const source = ts.createSourceFile('types.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.deepEqual(source.parseDiagnostics, []);
const declarations = source.statements.filter(ts.isFunctionDeclaration);
assert.equal(declarations.length, annotations.length);
const chunks = declarations.map((node, id) => ({ id, chunkUid: `types:${id}`, file: 'types.ts', lang: 'typescript',
  kind: 'FunctionDeclaration', name: node.name.text, start: node.getStart(source), end: node.end, docmeta: {} }));
const byChunkUid = new Map(declarations.map((node, id) => [chunks[id].chunkUid, { payload: normalizeProviderPayload({
  signature: text.slice(node.getStart(source), node.body.getStart(source)).trim(),
  returnType: node.type.getText(source), paramTypes: { input: [{ type: node.parameters[0].type.getText(source),
    source: 'annotation', languageId: 'typescript', confidence: 1 }] }
}) }]));
const options = { byChunkUid, chunkByUid: new Map(chunks.map(chunk => [chunk.chunkUid, chunk])) };
applyToolingTypes(options);
const snapshot = JSON.stringify(chunks);
applyToolingTypes(options);
assert.equal(JSON.stringify(chunks), snapshot, 'repeated actual tooling application preserves exact serialized facts');
assert.ok(chunks.every(chunk => Object.getPrototypeOf(chunk.docmeta.paramTypes) === null));
const index = buildFilterIndex(chunks);
for (const [id, annotation] of annotations.entries()) {
  assert.deepEqual(filterChunks(chunks, { returnType: annotation }, index).map(chunk => chunk.id), [id],
    'parser annotation → provider admission → tooling application → strict indexed filter: ' + annotation);
  assert.equal(chunks[id].docmeta.paramTypes.input, annotation);
}
assert.deepEqual(filterChunks(chunks, { returnType: 'Boolean|boolean' }, index).map(chunk => chunk.id), [6]);
console.log('Parser-owned boxed/primitive and literal identities remain distinct through actual tooling and filtering.');
