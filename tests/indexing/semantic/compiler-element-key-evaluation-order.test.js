import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';

// UNVALIDATED. Inspect actual compiler/retained products; never evaluate source hooks.
const build = text => {
  const sourceFile = ts.createSourceFile('element-key.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(sourceFile.parseDiagnostics.length, 0);
  return { sourceFile, ...buildCompilerFlowGraph({ ts, sourceFile, owner: sourceFile.statements[0],
    expressionFor: node => node ? { partitionId: 'element-key-fixture', localId: node.getStart(sourceFile) } : null }) };
};
const normal = start => {
  const result = [], seen = new Set();
  for (let block = start; block && !seen.has(block);) {
    seen.add(block); result.push(block);
    const next = block.successors.filter(edge => edge.kind !== 'exceptional');
    assert.ok(next.length <= 1, 'control fixture has a single ordinary route');
    block = next[0]?.to;
  }
  return result;
};
for (const operation of ['object[key()] = rhs()', 'object[key()] += rhs()', 'object[key()]++', 'delete object[key()]']) {
  const graph = build(`function ordered(object) { try { ${operation}; after(); } catch(error) { recover(); } }`);
  const route = normal(graph.entry), conversions = route.filter(block => block.event?.kind === 'propertyKey');
  assert.equal(conversions.length, 1, operation + ': one reference conversion');
  assert.equal(route.filter(block => block.event?.kind === 'operation' && ts.isCallExpression(block.node)
    && block.node.expression.getText(graph.sourceFile) === 'key').length, 1, 'key expression evaluates once');
  const conversion = conversions[0];
  const rhs = route.find(block => block.event?.kind === 'operation' && ts.isCallExpression(block.node)
    && block.node.expression.getText(graph.sourceFile) === 'rhs');
  if (rhs) assert.equal(route.indexOf(conversion) < route.indexOf(rhs), operation.includes('+='),
    'simple PutValue conversion follows the RHS; compound GetValue conversion precedes it');
  const failure = normal(conversion.successors.find(edge => edge.kind === 'exceptional').to);
  assert.deepEqual(failure.filter(block => block.event?.kind === 'operation' && ts.isCallExpression(block.node))
    .map(block => block.node.expression.getText(graph.sourceFile)), ['recover'], 'conversion failure skips the remaining body');
}
const primitive = build('function primitive(object) { return object["fixed"]; }');
const primitiveKey = primitive.blocks.find(block => block.event?.kind === 'propertyKey');
assert.equal(primitiveKey.event.mayThrow, false);
assert.ok(!primitiveKey.successors.some(edge => edge.kind === 'exceptional'), 'primitive key conversion adds no invented coercion exception');
const regexp = build('function regexp(object) { return object[/object/]; }');
assert.equal(regexp.blocks.find(block => block.event?.kind === 'propertyKey').event.mayThrow, true,
  'a regular-expression literal is an object, not a primitive key proof');
const optional = build('function optional(object) { return delete object?.[key()]; }');
const guard = optional.blocks.find(block => block.event?.predicate?.operation === 'isNullish');
const skipped = normal(guard.successors.find(edge => edge.kind === 'controlTrue').to);
assert.ok(skipped.every(block => block.event?.kind !== 'propertyKey' && !ts.isCallExpression(block.node)),
  'the nullish route skips both the key expression and its conversion');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-element-key-order-'));
try {
  const text = 'export {};\n' + [['assignment', '='], ['compound', '+=']].map(([name, operator]) =>
    `function ${name}(object: any, key: any) { let value = 0;
      try { object[key] ${operator} (value = 1); } catch (error) { return value; }
      return value;
    }`).join('\n') + '\nfunction keyError(object: any, key: any) { try { return object[key]; } catch (error) { return error; } }';
  const fixture = await createCompilerBoundaryFixture(root, { 'element-key.ts': text }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0];
  const store = fixture.storeFor(fixture.syntaxPartitions);
  await validateSemanticPartitions({ store, partitions: fixture.syntaxPartitions });
  const edges = [];
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_edges')) edges.push(row);
  const key = canonicalRef => canonicalRef.partitionId + ':' + canonicalRef.localId;
  const predecessors = new Map();
  for (const edge of edges) if (['reads', 'flowsTo', 'defines'].includes(edge.kind)) {
    const to = key(edge.to);
    if (!predecessors.has(to)) predecessors.set(to, []);
    predecessors.get(to).push(key(edge.from));
  }
  for (const name of ['assignment', 'compound']) {
    const owner = doc.sourceFile.statements.find(node => node.name?.text === name);
    const attempt = owner.body.statements[1], catchRead = doc.expressionFor(attempt.catchClause.block.statements[0].expression);
    const initial = doc.expressionFor(owner.body.statements[0].declarationList.declarations[0].initializer);
    const assigned = doc.expressionFor(attempt.tryBlock.statements[0].expression.right.expression.right);
    const pending = [key(catchRead)], reached = new Set();
    while (pending.length) { const current = pending.pop(); if (reached.has(current)) continue; reached.add(current); pending.push(...predecessors.get(current) || []); }
    assert.equal(reached.has(key(initial)), name === 'compound', 'only compound GetValue can fail before this pure RHS writes value=1');
    assert.ok(reached.has(key(assigned)), 'actual retained catch preserves post-RHS PutValue failure');
    assert.equal(flow.summaries.find(summary => summary.owner === owner).complete, false);
  }
  const errorOwner = doc.sourceFile.statements.find(node => node.name?.text === 'keyError');
  const errorAttempt = errorOwner.body.statements[0];
  const keyInput = doc.expressionFor(errorAttempt.tryBlock.statements[0].expression.argumentExpression);
  const catchError = doc.expressionFor(errorAttempt.catchClause.block.statements[0].expression);
  const pendingError = [key(catchError)], errorInputs = new Set();
  while (pendingError.length) { const current = pendingError.pop(); if (errorInputs.has(current)) continue; errorInputs.add(current); pendingError.push(...predecessors.get(current) || []); }
  assert.ok(errorInputs.has(key(keyInput)), 'retained unknown coercion exception carries its source key input into the catch value');
  assert.ok(fixture.state.semanticFactsByFile.get(doc.item.file).coverage.some(row => row.phase === 'localFlow'
    && row.reason?.includes('property_key_coercion_effects_unresolved')),
  'unknown coercion hooks and heap effects remain an explicit frontier');
  console.log('Element reference key conversion ordering and retained reaching definitions test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
