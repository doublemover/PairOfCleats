import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPublishedSemanticWitness } from '../../helpers/published-semantic-witness.js';
import { createSemanticTraceParityBackends } from '../../helpers/compiler-trace-backends.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { normalizeTypeExpression } from '../../../src/retrieval/output/filters/type-expression.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-strict-discovery-'));
let backends;
try {
  const repo = path.join(root, 'repo'); await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, 'types.ts'), [
    'export class Flag { value:boolean = true; }',
    'export function exact(flag:boolean):boolean { const local:boolean = flag; return local; }',
    'export function promised():Promise<boolean> { return Promise.resolve(true); }',
    'export function array():boolean[] { return [false]; }',
    'export function union():boolean|string { return false; }',
    'export function nominal():Boolean { return new Boolean(true); }',
    'type FlagAlias = boolean; export function alias(flag:FlagAlias):FlagAlias { return flag; }'
  ].join('\n'));
  const fixture = await createPublishedSemanticWitness({ root });
  backends = await createSemanticTraceParityBackends({ artifact: fixture.store, partitions: fixture.manifest.partitions,
    generation: fixture.manifest.generation, repoRoot: fixture.repoRoot });
  backends.sqlite.getSourceSpans = fixture.store.getSourceSpans;
  const find = async (store, selector) => {
    const service = createSemanticFindService(); let cursor = null; const matches = [];
    do {
      const result = await service({ store, request: { repoRoot: fixture.repoRoot,
        generation: fixture.manifest.generation, selector, cursor, limits: { records: 2, bytes: 65536, workMs: 250 } } });
      matches.push(...result.matches); cursor = result.cursor;
    } while (cursor);
    return matches;
  };
  const selector = { typeExpression: { expression: 'number', match: 'exact-expression', sources: ['compiler'], roles: ['parameter'] } };
  const compiler = await find(backends.artifact, selector);
  assert.ok(compiler.length, 'actual checker emits pinned parameter type facts');
  assert.ok(compiler.every(match => match.fact.source === 'compiler' && match.fact.role === 'parameter'
    && match.fact.compilerContextKey && normalizeTypeExpression(match.fact.expression) === normalizeTypeExpression('number')));
  assert.deepEqual(await find(backends.sqlite, selector), compiler);
  const declared = await find(backends.artifact, { typeExpression: { ...selector.typeExpression, sources: ['declared'] } });
  assert.ok(declared.length); assert.ok(declared.every(match => match.fact.source === 'declared' && match.fact.compilerContextKey === null));
  assert.deepEqual(await find(backends.artifact, { typeExpression: { ...selector.typeExpression, expression: 'Promise<number>' } }), []);
  assert.deepEqual(await find(backends.artifact, { typeExpression: { ...selector.typeExpression, expression: 'Number' } }), []);
  const booleanReturns = await find(backends.artifact, { typeExpression: {
    expression: 'boolean', match: 'exact-expression', sources: ['compiler'], roles: ['return'] } });
  assert.ok(booleanReturns.length);
  assert.ok(booleanReturns.every(match => normalizeTypeExpression(match.fact.expression) === normalizeTypeExpression('boolean')));
  for (const role of ['local', 'parameter', 'field']) {
    const matches = await find(backends.artifact, { typeExpression: {
      expression: 'boolean', match: 'exact-expression', sources: ['compiler'], roles: [role] } });
    assert.ok(matches.length, role); assert.ok(matches.every(match => match.fact.role === role));
  }
  const aliases = await find(backends.artifact, { typeExpression: {
    expression: 'FlagAlias', match: 'exact-expression', sources: ['declared'], roles: ['parameter', 'return'] } });
  assert.ok(aliases.length); assert.ok(aliases.every(match => match.fact.source === 'declared'));
  const inferredAliasOwners = new Set((await find(backends.artifact, { typeExpression: {
    expression: 'boolean', match: 'exact-expression', sources: ['compiler'], roles: ['parameter', 'return'] } })).map(match => JSON.stringify(match.fact.owner)));
  assert.ok(aliases.every(match => inferredAliasOwners.has(JSON.stringify(match.fact.owner))),
    'checker boolean and exact declared alias retain independent provenance for the same owner');
  assert.deepEqual(await find(backends.artifact, { typeExpression: {
    expression: 'FlagAlias', match: 'exact-expression', sources: ['compiler'], roles: ['parameter', 'return'] } }), []);
  const literal = { literal: { type: 'number', representation: '10' } };
  const values = await find(backends.artifact, literal); assert.ok(values.length);
  assert.ok(values.every(match => match.fact.source === 'literal' && match.fact.sourceHash
    && match.fact.scalar.representation === '10'));
  assert.deepEqual(await find(backends.sqlite, literal), values);
  assert.deepEqual(await find(backends.artifact, { literal: { type: 'string', representation: '"10"' } }), []);
  console.log('Real published compiler/declaration role facts and scalar occurrences match artifact/SQLite with exact provenance.');
} finally { backends?.close(); await fs.rm(root, { recursive: true, force: true }); }
