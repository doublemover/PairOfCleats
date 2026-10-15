import assert from 'node:assert/strict';
import ts from 'typescript';
import { emitCompilerTypeFacts } from '../../../src/index/semantic/compiler-type-facts.js';
import { semanticLiteralScalar } from '../../../src/index/semantic/semantic-literal.js';

const run = async (text, expression) => {
  const sourceFile = ts.createSourceFile('facts.ts', text, ts.ScriptTarget.Latest, true);
  const nodes = []; const walk = node => { nodes.push(node); ts.forEachChild(node, walk); }; walk(sourceFile);
  let allocated = 0;
  const partitionId = 'sa1:' + 'a'.repeat(64), ref = localId => ({ partitionId, localId });
  const owners = new WeakMap(); let nextOwner = 0;
  const owner = node => {
    if (!owners.has(node)) owners.set(node, { partitionId: 'sy1:' + 'b'.repeat(64), localId: nextOwner++ });
    return owners.get(node);
  };
  const result = await emitCompilerTypeFacts({ ts, sourceFile, nodes,
    checker: { getSignatureFromDeclaration: () => ({}), getReturnTypeOfSignature: () => ({}),
      getTypeAtLocation: () => ({}), typeToString: () => typeof expression === 'function' ? expression() : expression },
    context: { contextKey: 'compiler-context' }, declarationFor: owner, expressionFor: owner,
    ref, evidence: { partitionId, localId: 0 }, allocate: () => ref(allocated++) });
  const ids = result.rows.filter(entry => entry.family === 'node').map(entry => entry.row.id);
  assert.deepEqual(ids, Array.from({ length: allocated }, (_, id) => id), 'budget rejection must not create node-ID gaps');
  return result;
};
const rest = await run('export function rest(x:[...boolean[]]):boolean { return true; }', '[...boolean[]]');
assert.equal(rest.reasons.length, 0);
assert.ok(rest.rows.some(entry => entry.family === 'node' && entry.row.data.expression.includes('...')));
const truncated = await run('export function union(x:number) { return x; }', 'A | ... 400 more ... | Z');
assert.ok(truncated.reasons.includes('type_fact_expression_budget_or_truncation'));
const exhausted = await run(Array.from({ length: 40 }, (_, id) => 'let v' + id + '=true;').join('\n'), 'X'.repeat(65000));
assert.ok(exhausted.reasons.includes('type_fact_total_byte_budget'));
assert.ok(exhausted.completedCount < exhausted.observedCount);
const oversized = await run('let typed:' + 'X'.repeat(66000) + '=true;', 'boolean');
assert.ok(oversized.reasons.includes('declared_type_expression_budget'));
const declaredOnly = await run('let declared:boolean=true;', () => { throw new Error('Owned checker unavailable'); });
assert.ok(declaredOnly.rows.some(entry => entry.family === 'node' && entry.row.data.origin === 'declared'));
assert.ok(!declaredOnly.rows.some(entry => entry.family === 'node' && entry.row.data.origin === 'checker-inferred'));
assert.ok(declaredOnly.reasons.includes('checker_type_failure')); assert.equal(declaredOnly.completedCount, 0);
assert.deepEqual(semanticLiteralScalar({ kind: 'BooleanLiteral', value: true }), { type: 'boolean', representation: 'true' });
assert.deepEqual(semanticLiteralScalar({ kind: 'StringLiteral', value: 'true' }), { type: 'string', representation: '"true"' });
assert.deepEqual(semanticLiteralScalar({ kind: 'BigIntLiteral', value: '9007199254740993' }), { type: 'bigint', representation: '9007199254740993' });
assert.equal(semanticLiteralScalar({ kind: 'RegExpLiteral', value: /true/ }), null);
console.log('Type-fact row allocation/budget frontiers, legitimate rest syntax and scalar distinctions passed.');
