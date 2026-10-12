#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterChunks } from '../../../src/retrieval/output.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { resolveReturnTypeFacts } from '../../../src/retrieval/output/filters/type-expression.js';
import { buildQueryPlanConfigSignature } from '../../../src/retrieval/query-plan-cache.js';

const types = ['boolean', 'Promise<boolean>', 'boolean[]', 'boolean | string', 'Boolean',
  'MybooleanWrapper', '"boolean"', 'true', 'Flag', '{ ok: boolean; value: string }'];
const chunks = types.map((type, id) => ({ id, file: `src/${id}.ts`, kind: 'FunctionDeclaration', docmeta: { returns: type } }));
chunks.push({ id: chunks.length, file: 'src/absent.ts', docmeta: { inferredTypes: { returns: [{ type: 'boolean', source: 'heuristic' }] } } });
chunks.push({ id: chunks.length, file: 'src/compiler.ts', docmeta: { returns: 'boolean', inferredTypes: { returns: [{ type: 'number', source: 'tooling', confidence: 0.85 }] } } });
chunks.push({ id: chunks.length, file: 'src/compiler-inferred.ts', metaV2: { types: { tooling: { returns: [{ type: 'boolean', source: 'tooling' }] } } } });
chunks.push({ id: chunks.length, file: 'src/symbolic-display.ts', docmeta: { typeExpressions: { display: { returnType: 'boolean' } } } });
const index = buildFilterIndex(chunks);
const ids = (returnType) => filterChunks(chunks, { returnType }, index).map((chunk) => chunk.id);
assert.deepEqual(ids('boolean'), [0, 12]);
assert.deepEqual(ids('Promise<boolean>'), [1]);
assert.deepEqual(ids('boolean[]'), [2]);
assert.deepEqual(ids('boolean|string'), [3]);
assert.deepEqual(ids('Boolean'), [4]);
assert.deepEqual(ids('Flag'), [8], 'aliases are only matched as recorded, never implicitly expanded');
assert.deepEqual(ids('{ok:boolean;value:string}'), [9]);
assert.deepEqual(ids('number'), [11], 'tooling returns take precedence over stale/heuristic declared fallback');
assert.deepEqual(ids('missing'), []);
assert.equal(resolveReturnTypeFacts(chunks[12])[0].source, 'tooling');
assert.equal(resolveReturnTypeFacts(chunks[0])[0].source, 'declared');
assert.notEqual(ids('"bo olean"').length, 1, 'literal whitespace is significant');
for (const key of ['return-type', 'inferred-type', 'calls', 'extends', 'alias', 'returns']) {
  assert.notEqual(buildQueryPlanConfigSignature({ structuredFilters: { [key]: 'one' } }),
    buildQueryPlanConfigSignature({ structuredFilters: { [key]: 'two' } }), `cache must bind ${key}`);
}
console.log('strict return type and filter cache identity test passed');
