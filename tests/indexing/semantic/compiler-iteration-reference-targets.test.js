import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only. Inspect actual CFG/reaching-definition/call-owner consumers;
// no iterable, key expression, getter, loop body or source function is executed.
const build = text => {
  const sourceFile = ts.createSourceFile('iteration.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(sourceFile.parseDiagnostics.length, 0);
  return { sourceFile, ...buildCompilerFlowGraph({ ts, sourceFile, owner: sourceFile.statements[0],
    expressionFor: node => node ? { partitionId: 'iteration', localId: node.getStart(sourceFile) } : null }) };
};
const segment = (start, until) => {
  const path = [], seen = new Set();
  for (let block = start; block && block !== until && !seen.has(block);) {
    seen.add(block); path.push(block);
    const successors = block.successors.filter(edge => edge.kind !== 'exceptional');
    assert.ok(successors.length <= 1);
    block = successors[0]?.to;
  }
  return path;
};
const names = (graph, blocks) => blocks.filter(block => block.event?.kind === 'operation'
  && ts.isCallExpression(block.node)).map(block => block.node.expression.getText(graph.sourceFile));
for (const operator of ['of', 'in']) {
  const graph = build(`function iterate() { for (((base().child[key()])) ${operator} iterable()) { use(); continue; } after(); }`);
  const branch = graph.blocks.find(block => block.event?.predicate?.operation === (operator === 'of' ? 'iteratorHasNext' : 'enumeratorHasNext'));
  assert.deepEqual(names(graph, segment(graph.entry, branch)), ['iterable'], 'the iterable/expression is evaluated once before the first iteration test');
  const body = segment(branch.successors.find(edge => edge.kind === 'controlTrue').to, branch);
  assert.deepEqual(names(graph, body), ['base', 'key', 'use'], operator + ' evaluates receiver then key before entering the body');
  const assignment = body.findIndex(block => block.event?.kind === 'heapWrite');
  const key = body.findIndex(block => ts.isCallExpression(block.node) && block.node.expression.getText(graph.sourceFile) === 'key');
  const use = body.findIndex(block => ts.isCallExpression(block.node) && block.node.expression.getText(graph.sourceFile) === 'use');
  assert.ok(key < assignment && assignment < use);
  assert.equal(body[assignment].event.target.getText(graph.sourceFile), 'base().child[key()]');
  assert.equal(body[assignment].event.origin, 'unknown', 'the iterator result/key remains its existing unknown value rather than the iterable itself');
  assert.deepEqual(body.filter(block => block.event?.kind === 'heapRead').map(block => block.node.getText(graph.sourceFile)), ['base().child'],
    'receiver getters still run, while a simple iteration assignment does not read its selected property');
  const continued = body.find(block => block.event?.kind === 'abrupt');
  assert.equal(continued.successors[0].to, branch, 'continue resumes the next iteration test before reevaluating its target');
  assert.deepEqual(names(graph, segment(branch.successors.find(edge => edge.kind === 'controlFalse').to, null)), ['after'],
    'a loop with no produced element/key never evaluates the target');
}
const caught = build('function caught(values, box) { try { for (box[key()] of values) { body(); } } catch (error) { recover(); } finally { clean(); } }');
const keyCall = caught.blocks.find(block => ts.isCallExpression(block.node) && block.node.expression.getText(caught.sourceFile) === 'key');
const failed = segment(keyCall.successors.find(edge => edge.kind === 'exceptional').to, null);
assert.deepEqual(names(caught, failed), ['recover', 'clean'], 'target failure skips assignment/body and preserves the current catch/finally route');
const lexical = build('function lexical(values) { for (let value of values) { consume(value); } }');
assert.equal(lexical.blocks.filter(block => block.event?.kind === 'heapWrite').length, 0);
assert.ok(lexical.reasons.has('iterator_protocol_and_per_iteration_binding_conservative'));

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-iteration-reference-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'iteration.ts': `export {};
    function key() { return 'value'; }
    function each(values: number[], box: { value: number }, input: number) {
      let snapshot = 0;
      for (box[(snapshot = input, 'value')] of values) { return snapshot; }
      return 0;
    }
    function named(values: number[], box: { value: number }) { for (box[key()] of values) { continue; } }
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0];
  const store = fixture.storeFor(fixture.syntaxPartitions);
  await validateSemanticPartitions({ store, partitions: fixture.syntaxPartitions });
  const key = ref => ref.partitionId + ':' + ref.localId;
  const each = doc.sourceFile.statements.find(node => node.name?.text === 'each');
  const loop = each.body.statements[1], returned = doc.expressionFor(loop.statement.statements[0].expression);
  const mutation = doc.nodes.find(node => doc.ts.isBinaryExpression(node) && node.operatorToken.kind === doc.ts.SyntaxKind.EqualsToken
    && node.left.getText(doc.sourceFile) === 'snapshot');
  const edges = [], values = new Map();
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_edges')) edges.push(row);
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_records')) values.set(row.id, row);
  const reaching = edges.filter(edge => edge.kind === 'reads' && key(edge.to) === key(returned));
  assert.equal(reaching.length, 1);
  assert.equal(values.get(reaching[0].from.localId).data.origin, 'definition');
  assert.ok(edges.some(edge => edge.kind === 'defines' && key(edge.to) === key(reaching[0].from)
    && key(edge.from) === key(doc.expressionFor(mutation.right))), 'the loop body receives the key-evaluation assignment rather than the pre-loop zero');
  const named = doc.sourceFile.statements.find(node => node.name?.text === 'named');
  const invocation = doc.nodes.find(node => doc.ts.isCallExpression(node) && node.getText(doc.sourceFile) === 'key()');
  const effect = flow.callEffects.find(row => key(row.result) === key(doc.expressionFor(invocation)));
  assert.ok(effect && key(effect.ownerRef) === key(doc.expressionFor(named)), 'iteration target calls retain the actual enclosing CFG execution owner');
  flow.calls = [{ occurrence: doc.expressionFor(invocation), result: doc.expressionFor(invocation), span: [invocation.getStart(doc.sourceFile), invocation.end],
    targets: [], incompleteTargets: true, invocationKind: 'call', arguments: [], hasSpread: false }];
  assert.deepEqual(buildCallDependencySummaries([flow]).ownershipReasons, [], 'the actual summary owner consumes that canonical execution route');
  assert.equal(flow.summaries.find(summary => summary.owner === each).complete, false,
    'iterator protocol, yielded-value and per-iteration binding effects remain explicit frontiers');
  console.log('iteration reference targets preserve per-element evaluation, reaching definitions and call ownership');
} finally { await fs.rm(root, { recursive: true, force: true }); }
