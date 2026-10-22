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

// Authored only: parse compiler syntax and inspect actual CFG/persisted flow.
// The source functions and their coercion hooks are never executed.
const build = text => {
  const sourceFile = ts.createSourceFile('property-keys.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(sourceFile.parseDiagnostics.length, 0);
  return { sourceFile, ...buildCompilerFlowGraph({ ts, sourceFile, owner: sourceFile.statements[0],
    expressionFor: node => node ? { partitionId: 'property-keys', localId: node.getStart(sourceFile) } : null }) };
};
const normalCalls = (graph, start = graph.entry) => {
  const names = [], seen = new Set();
  for (let block = start; block && !seen.has(block);) {
    seen.add(block);
    if (block.event?.kind === 'operation' && ts.isCallExpression(block.node)) names.push(block.node.expression.getText(graph.sourceFile));
    const next = block.successors.filter(edge => edge.kind !== 'exceptional');
    assert.ok(next.length <= 1, 'the control fixture has one ordinary successor');
    block = next[0]?.to;
  }
  return names;
};
const mixed = build(`function mixed() { const object = {
  [firstKey()]: firstValue(), [methodKey()](arg = defaultOnly()) { methodOnly(); },
  get [getterKey()]() { getterOnly(); }, set [setterKey()](value) { setterOnly(); }, plain: plainValue()
}; after(); }`);
assert.deepEqual(normalCalls(mixed), ['firstKey', 'firstValue', 'methodKey', 'getterKey', 'setterKey', 'plainValue', 'after']);
const conversions = mixed.blocks.filter(block => ts.isComputedPropertyName(block.node));
assert.equal(conversions.length, 4, 'every data/method/accessor key converts once');
assert.ok(conversions.every(block => block.successors.some(edge => edge.kind === 'exceptional')));
for (const conversion of conversions) {
  const dependency = compilerOperationDependencies(ts, conversion.node);
  assert.equal(dependency.mayThrow, true);
  assert.equal(dependency.inputs[0].node, conversion.node.expression);
  assert.equal(dependency.inputs[0].certainty, 'modeled');
}
const caught = build('function caught(key) { try { const object = { [key]: value(), [laterKey()]: laterValue() }; after(); } catch (error) { recover(); } finally { clean(); } }');
const conversion = caught.blocks.find(block => ts.isComputedPropertyName(block.node) && block.node.expression.getText(caught.sourceFile) === 'key');
assert.deepEqual(normalCalls(caught, conversion.successors.find(edge => edge.kind === 'exceptional').to), ['recover', 'clean'],
  'conversion failure skips its initializer and later properties, then follows the existing catch/finally route');
const classControl = build('function classControl() { class C { [classKey()]() { methodOnly(); } static value = staticValue(); } after(); }');
assert.deepEqual(normalCalls(classControl), ['classKey', 'staticValue', 'after']);
assert.equal(classControl.blocks.filter(block => ts.isComputedPropertyName(block.node)).length, 1);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-property-key-conversion-'));
try {
  const variants = {
    property: '[key]: (x = 1)', method: '[key](arg = (x = 8)) { x = 9; }',
    getter: 'get [key]() { x = 9; return 1; }', setter: 'set [key](value: number) { x = 9; }'
  };
  const text = 'export {};\n' + Object.entries(variants).map(([name, member]) =>
    `function ${name}(key: any) { let x = 0; try { const object = { ${member} }; x = 2; } catch (error) { return x; } return x; }`).join('\n');
  const fixture = await createCompilerBoundaryFixture(root, { 'keys.ts': text }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0];
  const slice = await collectCompilerValueSlice({ ...doc, source: doc.item.source, root: fixture.stagingRoot,
    diskAccount: fixture.state.semanticDiskAccount, context: fixture.group.context, isDefaultLibrary: fixture.group.isDefaultLibrary });
  const partitions = [...fixture.syntaxPartitions, slice.partition], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const key = ref => ref.partitionId + ':' + ref.localId;
  const values = new Map(), edges = [], sliceEdges = [];
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_records')) values.set(row.id, row);
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_edges')) edges.push(row);
  for await (const row of store.iterateRows(slice.partition.partitionId, 'semantic_edges')) sliceEdges.push(row);
  for (const name of Object.keys(variants)) {
    const owner = doc.sourceFile.statements.find(node => node.name?.text === name), attempt = owner.body.statements[1];
    const initialValue = doc.expressionFor(owner.body.statements[0].declarationList.declarations[0].initializer);
    const catchRead = doc.expressionFor(attempt.catchClause.block.statements[0].expression);
    const reaching = edges.filter(edge => edge.kind === 'reads' && key(edge.to) === key(catchRead));
    assert.equal(reaching.length, 1, name + ' catch return has one reaching definition');
    assert.equal(values.get(reaching[0].from.localId).data.origin, 'definition');
    assert.ok(edges.some(edge => edge.kind === 'defines' && key(edge.to) === key(reaching[0].from)
      && key(edge.from) === key(initialValue)), name + ' conversion failure reaches x=0 before any initializer/body/after write');
    const member = attempt.tryBlock.statements[0].declarationList.declarations[0].initializer.properties[0];
    const input = doc.expressionFor(member.name.expression), converted = doc.expressionFor(member.name);
    assert.ok(edges.some(edge => edge.kind === 'flowsTo' && key(edge.from) === key(input) && key(edge.to) === key(converted)));
    assert.ok(sliceEdges.some(edge => edge.kind === 'flowsTo' && key(edge.from) === key(input) && key(edge.to) === key(converted)),
      name + ' immutable value consumer retains the same source key input');
    const summary = flow.summaries.find(row => row.owner === owner);
    assert.equal(summary.returns.length, 2, name + ' retains catch and ordinary return alternatives');
    assert.equal(summary.complete, false, 'coercion effects remain an explicit frontier');
  }
  console.log('computed property conversion preserves source order, exceptional routing and actual reaching definitions');
} finally { await fs.rm(root, { recursive: true, force: true }); }
