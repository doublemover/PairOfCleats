import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerImplicitCalls } from '../../../src/index/semantic/compiler-implicit-calls.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only: actual compiler property symbols -> CFG ownership -> retained
// call channels. No loop, iterator, accessor or source function is executed.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-iteration-accessor-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'iteration.ts': `export {};
    class Box {
      backing: number | string = 0;
      get value(): number | string { return this.backing; }
      set value(input: number | string) { this.backing = input; }
      get child(): Box { return this; }
    }
    function iterateOf(box: Box, values: number[]) { for (((box.value!)) of values) {} }
    function iterateIn(box: Box, values: object) { for (box['value'] in values) {} }
    async function iterateAsync(box: Box, values: AsyncIterable<number>) { for await (box.value of values) {} }
    function nested(box: Box, values: number[]) { for (box.child.value of values) {} }
    function lexical(box: Box, values: number[]) { for (const value of values) { box.value; } }
    function ordinary(box: Box, input: number) { box.value = input; }
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0], { ts, checker, sourceFile, nodes, expressionFor } = doc;
  assert.equal(sourceFile.parseDiagnostics.length, 0);
  const declarationRef = node => {
    const anchor = node.name || node;
    return doc.item.declarations.get(anchor.getStart(sourceFile) + ':' + anchor.end)
      || (ts.isFunctionLike(node) ? expressionFor(node) : null);
  };
  const functionOwner = node => {
    while (node && !ts.isFunctionDeclaration(node)) node = node.parent;
    return node;
  };
  const calls = collectCompilerImplicitCalls({ ts, checker, nodes, expressionFor, declarationRef });
  const callsFor = name => calls.filter(call => functionOwner(call.node)?.name?.text === name);
  for (const name of ['iterateOf', 'iterateIn', 'iterateAsync']) {
    const selected = callsFor(name);
    assert.deepEqual(selected.map(call => call.invocationKind), ['setter'], name + ' selects the assignment setter, without a target getter');
    const call = selected[0], owner = functionOwner(call.node), loop = owner.body.statements[0];
    assert.deepEqual(call.arguments, [null], 'a produced element/key has no admitted value expression');
    assert.deepEqual(call.unknownInputs, [expressionFor(loop.expression)], 'iterable evaluation remains an unknown influence rather than a setter argument value');
    assert.equal(call.suppressResult, true);
    assert.ok(call.reason.includes('iteration_assignment_value_unresolved'));
    const route = flow.callEffects.find(route => JSON.stringify(route.result) === JSON.stringify(call.result));
    assert.ok(route);
    assert.deepEqual(route.ownerRef, expressionFor(owner), 'the existing CFG execution owner admits the implicit write');
  }
  assert.deepEqual(callsFor('nested').map(call => [call.node.getText(sourceFile), call.invocationKind]).sort(),
    [['box.child', 'getter'], ['box.child.value', 'setter']], 'the target setter does not suppress its receiver getter');
  assert.deepEqual(callsFor('lexical').map(call => call.invocationKind), ['getter'], 'ordinary body reads keep their getter role');
  const ordinary = callsFor('ordinary')[0], assignment = functionOwner(ordinary.node).body.statements[0].expression;
  assert.deepEqual(ordinary.arguments, [expressionFor(assignment.right)], 'ordinary assignment retains the actual RHS');
  flow.calls = calls;
  assert.deepEqual(buildCallDependencySummaries([flow]).ownershipReasons, []);
  const added = await collectCompilerCrossFileFlow(fixture), partitions = [...fixture.syntaxPartitions, ...added];
  const store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const key = ref => ref.partitionId + ':' + ref.localId, edges = [], coverage = [];
  for (const partition of added) {
    for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(edge);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  for (const name of ['iterateOf', 'iterateIn', 'iterateAsync']) {
    const call = callsFor(name)[0], site = key(call.occurrence);
    assert.ok(edges.some(edge => edge.kind === 'callTarget' && key(edge.callSite) === site && key(edge.to) === key(call.targets[0])));
    assert.ok(!edges.some(edge => edge.kind === 'returnToResult' && key(edge.callSite) === site), 'iteration assignment does not invent a getter result');
    assert.ok(!edges.some(edge => edge.kind === 'argumentToParameter' && key(edge.callSite) === site),
      'the iterable object or loop syntax cannot masquerade as its produced element/key');
  }
  assert.ok(coverage.some(row => row.state === 'partial' && row.reason.includes('iteration_assignment_value_unresolved')));
  console.log('iteration accessor assignment roles retain canonical setter and unknown value channels');
} finally { await fs.rm(root, { recursive: true, force: true }); }
