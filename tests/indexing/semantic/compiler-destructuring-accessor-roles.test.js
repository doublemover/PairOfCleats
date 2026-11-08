import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerImplicitCalls } from '../../../src/index/semantic/compiler-implicit-calls.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// UNVALIDATED: actual compiler symbols, conservative CFG execution owners and
// retained call channels. Source accessors, defaults and iterators do not run.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-destructuring-accessor-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'patterns.ts': `export {};
    class Box {
      backing: any = 0;
      get value(): any { return this.backing; }
      set value(input: any) { this.backing = input; }
      get child(): Box { return this; }
      get key(): string { return 'value'; }
    }
    function array(box: Box, values: any[]) { [box.value] = values; }
    function wrapped(box: Box, values: any[]) { [((box.value!))] = values; }
    function object(box: Box, input: any) { ({ value: box.value } = input); }
    function nested(box: Box, input: any) { ({ pair: [box.child.value] } = input); }
    function rest(box: Box, values: any[]) { [...box.value] = values; }
    function objectRest(box: Box, input: any) { ({ ...box.value } = input); }
    function defaultTarget(box: Box, values: any[], fallback: any) { [box.value = fallback] = values; }
    function nestedDefault(box: Box, input: any, fallback: any[]) { ({ pair: [box.value] = fallback } = input); }
    function defaultRead(box: Box, values: any[]) { [box.value = box.child.value] = values; }
    function computedKey(box: Box, input: any) { ({ [box.key]: box.value } = input); }
    function iteration(box: Box, values: any[][]) { for ([box.value] of values) {} }
    function iterationIn(box: Box, values: object) { for ([box.value] in values) {} }
    async function iterationAsync(box: Box, values: AsyncIterable<any[]>) { for await ([box.value] of values) {} }
    function iterationDefault(box: Box, values: any[][], fallback: any) { for ([box.value = fallback] of values) {} }
    function ordinary(box: Box, fallback: any) { box.value = fallback; }
    function expressionDefault(box: Box, fallback: any) { return [box.value = fallback]; }
    function literal(box: Box) { return { value: box.value }; }
    function arrayRead(box: Box) { return [box.value]; }
    function rhsRead(box: Box) { [box.value] = [box.child.value]; }
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0];
  const { ts, checker, nodes, sourceFile, expressionFor } = doc;
  assert.equal(sourceFile.parseDiagnostics.length, 0);
  const declarationRef = node => {
    const anchor = node.name || node;
    return doc.item.declarations.get(anchor.getStart(sourceFile) + ':' + anchor.end)
      || (ts.isFunctionLike(node) ? expressionFor(node) : null);
  };
  const ownerName = node => {
    while (node && !ts.isFunctionDeclaration(node)) node = node.parent;
    return node?.name?.text || null;
  };
  const calls = collectCompilerImplicitCalls({ ts, checker, nodes, expressionFor, declarationRef });
  const callsFor = name => calls.filter(call => ownerName(call.node) === name);
  const key = ref => ref.partitionId + ':' + ref.localId;
  const identifierText = new Map();
  for (const node of nodes) if (ts.isIdentifier(node) && expressionFor(node)) identifierText.set(key(expressionFor(node)), node.text);
  const selectedTarget = name => callsFor(name).find(call => call.invocationKind === 'setter');
  for (const [name, input, fallback] of [
    ['array', 'values'], ['wrapped', 'values'], ['object', 'input'], ['rest', 'values'], ['objectRest', 'input'],
    ['defaultTarget', 'values', 'fallback'], ['nestedDefault', 'input', 'fallback'],
    ['iteration', 'values'], ['iterationIn', 'values'], ['iterationAsync', 'values'], ['iterationDefault', 'values', 'fallback']
  ]) {
    const selected = callsFor(name);
    assert.deepEqual(selected.map(call => call.invocationKind), ['setter'], name + ' selects only the written property setter');
    const call = selected[0];
    assert.deepEqual(call.arguments, [null], 'no extracted element/property/default value is fabricated');
    assert.deepEqual(call.unknownInputs.map(ref => identifierText.get(key(ref))), fallback ? [input, fallback] : [input]);
    assert.equal(call.suppressResult, true);
    assert.ok(call.reason.includes('destructuring_assignment_value_unresolved'));
    const route = flow.callEffects.find(value => key(value.result) === key(call.result));
    assert.ok(route, 'the existing conservative CFG retains the actual execution owner');
  }
  for (const name of ['nested', 'defaultRead', 'rhsRead']) {
    const selected = callsFor(name).map(call => [call.node.getText(sourceFile), call.invocationKind]).sort();
    const target = name === 'nested' ? 'box.child.value' : 'box.value';
    assert.ok(selected.some(([text, role]) => text === target && role === 'setter'));
    assert.ok(selected.some(([text, role]) => text === 'box.child' && role === 'getter'), 'receiver access still invokes its own getter');
    if (name !== 'nested') assert.ok(selected.some(([text, role]) => text === 'box.child.value' && role === 'getter'),
      'default/RHS reads are not mistaken for assignment targets');
  }
  assert.deepEqual(callsFor('computedKey').map(call => [call.node.getText(sourceFile), call.invocationKind]).sort(),
    [['box.key', 'getter'], ['box.value', 'setter']], 'computed source keys retain their evaluated getter');
  for (const name of ['ordinary', 'expressionDefault']) {
    const call = selectedTarget(name);
    assert.deepEqual(call.unknownInputs, []);
    assert.equal(identifierText.get(key(call.arguments[0])), 'fallback', 'an assignment expression inside a value array keeps its actual RHS');
  }
  for (const name of ['literal', 'arrayRead']) assert.deepEqual(callsFor(name).map(call => call.invocationKind), ['getter']);

  flow.calls = calls;
  const added = await collectCompilerCrossFileFlow(fixture), partitions = [...fixture.syntaxPartitions, ...added];
  const store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const edges = [], coverage = [];
  for (const partition of added) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  for (const name of ['array', 'wrapped', 'object', 'nested', 'rest', 'objectRest', 'defaultTarget', 'nestedDefault',
    'defaultRead', 'computedKey', 'iteration', 'iterationIn', 'iterationAsync', 'iterationDefault', 'rhsRead']) {
    const call = selectedTarget(name), site = key(call.occurrence);
    assert.ok(edges.some(edge => edge.kind === 'callTarget' && key(edge.callSite) === site && key(edge.to) === key(call.targets[0])));
    assert.ok(!edges.some(edge => edge.kind === 'returnToResult' && key(edge.callSite) === site), 'written targets do not invent getter returns');
    assert.ok(!edges.some(edge => edge.kind === 'argumentToParameter' && key(edge.callSite) === site),
      'a whole RHS, iterable or fallback expression is not the extracted assigned value');
  }
  assert.ok(coverage.some(row => row.state === 'partial' && row.reason.includes('destructuring_assignment_value_unresolved')));
  console.log('Destructuring accessor targets retain setter-only candidates and explicit unknown assigned values');
} finally { await fs.rm(root, { recursive: true, force: true }); }
