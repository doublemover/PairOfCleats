import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';
import { compilerOperationDependencies } from '../../../src/index/semantic/compiler-operation-dependencies.js';
import { collectCompilerValueSlice } from '../../../src/index/semantic/compiler-value-slice.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only: inspect the actual compiler CFG and retained analysis rows.
// The fixture source and its getters, setters and key functions are never run.
const build = text => {
  const sourceFile = ts.createSourceFile('references.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(sourceFile.parseDiagnostics.length, 0);
  return { sourceFile, ...buildCompilerFlowGraph({ ts, sourceFile, owner: sourceFile.statements[0],
    expressionFor: node => node ? { partitionId: 'references', localId: node.getStart(sourceFile) } : null }) };
};
const ordinaryPath = (graph, start = graph.entry) => {
  const path = [], seen = new Set();
  for (let block = start; block && !seen.has(block);) {
    seen.add(block); path.push(block);
    const successors = block.successors.filter(edge => edge.kind !== 'exceptional');
    assert.ok(successors.length <= 1, 'the selected path has no remaining branch');
    block = successors[0]?.to;
  }
  return path;
};
const calls = (graph, blocks = ordinaryPath(graph)) => blocks.filter(block => block.event?.kind === 'operation'
  && ts.isCallExpression(block.node)).map(block => block.node.expression.getText(graph.sourceFile));

for (const target of ['((box[key()]))', '(box[key()] as number)', '(box[key()]!)', '(box[key()] satisfies number)']) {
  const graph = build(`function store(box: any) { ${target} = rhs(); after(); }`);
  assert.deepEqual(calls(graph), ['key', 'rhs', 'after'], target + ' evaluates its key and RHS once in source order');
  const writes = graph.blocks.filter(block => block.event?.kind === 'heapWrite');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].event.target.getText(graph.sourceFile), 'box[key()]');
  assert.ok(!graph.blocks.some(block => block.event?.kind === 'heapRead'), 'plain assignment does not read the selected property');
  assert.ok(!graph.reasons.has('destructuring_write_requires_pattern_analysis'));
}
for (const operator of ['+=', '&&=', '||=', '??=']) {
  const graph = build(`function change(box: any, input: number) { (box.value) ${operator} input; }`);
  assert.equal(graph.blocks.filter(block => block.event?.kind === 'heapRead').length, 1, operator + ' retains its actual prior-value read');
  assert.equal(graph.blocks.filter(block => block.event?.kind === 'heapWrite').length, 1, operator + ' writes the unwrapped location');
}
for (const operation of ['(box.value)++', '--(box.value)']) {
  const graph = build(`function update(box: any) { ${operation}; }`);
  assert.equal(graph.blocks.filter(block => block.event?.kind === 'heapRead').length, 1);
  assert.equal(graph.blocks.filter(block => block.event?.kind === 'heapWrite').length, 1);
}
const deletion = build('function remove(box: any) { delete ((box.child[key()])); after(); }');
assert.deepEqual(calls(deletion), ['key', 'after']);
assert.deepEqual(deletion.blocks.filter(block => block.event?.kind === 'heapRead').map(block => block.node.getText(deletion.sourceFile)), ['box.child'],
  'deletion reads its receiver while leaving the selected property unread');
const deleted = deletion.blocks.find(block => ts.isDeleteExpression(block.node));
assert.ok(deleted.successors.some(edge => edge.kind === 'exceptional'), 'the deletion itself can still fail');
assert.deepEqual(compilerOperationDependencies(ts, deleted.node).inputs, [], 'stored property contents do not become the Boolean delete result');

const optional = build('function optional(box: any) { delete box?.[key()]; after(); }');
assert.equal(optional.blocks.filter(block => block.event?.kind === 'heapRead').length, 0);
const guard = optional.blocks.find(block => block.event?.predicate?.operation === 'isNullish');
const skipped = ordinaryPath(optional, guard.successors.find(edge => edge.kind === 'controlTrue').to);
const selected = ordinaryPath(optional, guard.successors.find(edge => edge.kind === 'controlFalse').to);
assert.deepEqual(calls(optional, skipped), ['after'], 'a nullish base skips the key');
assert.deepEqual(calls(optional, selected), ['key', 'after']);
assert.ok(skipped.filter(block => ts.isDeleteExpression(block.node)).every(block => !block.event.mayThrow
  && block.successors.every(edge => edge.kind !== 'exceptional')), 'the nullish delete completion cannot invent a deletion failure');
assert.ok(selected.some(block => ts.isDeleteExpression(block.node) && block.event.mayThrow));
const optionalNested = build('function optionalNested(box: any) { delete box?.child.value; }');
assert.deepEqual(optionalNested.blocks.filter(block => block.event?.kind === 'heapRead').map(block => block.node.getText(optionalNested.sourceFile)), ['box?.child']);
const expressionDelete = build('function expressionDelete(box: any) { delete (box.value, side()); }');
assert.deepEqual(calls(expressionDelete), ['side']);
assert.equal(expressionDelete.blocks.filter(block => block.event?.kind === 'heapRead').length, 1,
  'a comma expression consumes its left property value before deletion of the non-reference result');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-reference-evaluation-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'references.ts': `export {};
    function local(input: number) { let value = 0; (value as number) = input; return value; }
    function store(box: { value: number }, input: number) { ((box.value)) = input; return box.value; }
    function remove(box: { child: { value: number } }) { return delete ((box.child.value)); }
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0];
  const slice = await collectCompilerValueSlice({ ...doc, source: doc.item.source, root: fixture.stagingRoot,
    context: fixture.group.context, isDefaultLibrary: fixture.group.isDefaultLibrary, diskAccount: fixture.state.semanticDiskAccount });
  const partitions = [...fixture.syntaxPartitions, slice.partition], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const key = ref => ref.partitionId + ':' + ref.localId;
  const values = new Map(), edges = [], sliceEdges = [];
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_records')) values.set(row.id, row);
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_edges')) edges.push(row);
  for await (const row of store.iterateRows(slice.partition.partitionId, 'semantic_edges')) sliceEdges.push(row);
  const owner = name => doc.sourceFile.statements.find(node => node.name?.text === name);
  const local = owner('local'), assigned = local.body.statements[1].expression;
  const returned = doc.expressionFor(local.body.statements[2].expression);
  const reaching = edges.filter(edge => edge.kind === 'reads' && key(edge.to) === key(returned));
  assert.equal(reaching.length, 1, 'wrapped assignment retains one current lexical definition');
  assert.equal(values.get(reaching[0].from.localId).data.origin, 'definition');
  assert.ok(edges.some(edge => edge.kind === 'defines' && key(edge.from) === key(doc.expressionFor(assigned.right))
    && key(edge.to) === key(reaching[0].from)), 'the current value comes from the actual RHS rather than the earlier initializer');
  const propertyStore = owner('store').body.statements[0].expression;
  let storeTarget = propertyStore.left;
  while (ts.isParenthesizedExpression(storeTarget)) storeTarget = storeTarget.expression;
  const written = edges.find(edge => edge.kind === 'writes' && key(edge.to) === key(doc.expressionFor(storeTarget)));
  assert.ok(written, 'the retained heap write belongs to the selected property anchor');
  assert.ok(edges.some(edge => edge.kind === 'defines' && key(edge.from) === key(doc.expressionFor(propertyStore.right))
    && key(edge.to) === key(written.from)));
  assert.ok(!flow.fieldAccesses.some(access => key(access.ref) === key(doc.expressionFor(storeTarget))), 'the store target is not retained as a heap read');
  const remove = owner('remove').body.statements[0].expression;
  let removeTarget = remove.expression;
  while (ts.isParenthesizedExpression(removeTarget)) removeTarget = removeTarget.expression;
  assert.ok(!flow.fieldAccesses.some(access => key(access.ref) === key(doc.expressionFor(removeTarget))));
  assert.ok(flow.fieldAccesses.some(access => key(access.ref) === key(doc.expressionFor(removeTarget.expression))),
    'the receiver property remains an actual retained read');
  for (const rows of [edges, sliceEdges]) assert.ok(!rows.some(edge => edge.kind === 'flowsTo'
    && key(edge.from) === key(doc.expressionFor(remove.expression)) && key(edge.to) === key(doc.expressionFor(remove))),
  'neither actual value consumer turns the deleted stored value into its Boolean result');
  assert.equal(flow.summaries.find(summary => summary.owner === owner('remove')).complete, false,
    'deletion result and heap mutation remain an explicit unknown frontier');
  console.log('compiler reference evaluation retains wrapped writes, receiver/key order and optional deletion routes');
} finally { await fs.rm(root, { recursive: true, force: true }); }
