import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerImplicitCalls } from '../../../src/index/semantic/compiler-implicit-calls.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only. Actual checker property identity, implicit call projection and
// retained call-flow rows; no execution of the source methods or getters.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-accessor-roles-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'accessors.ts': `export {};
    class Box {
      backing = 1;
      get value() { return this.backing; }
      set value(input: number) { this.backing = input; }
      get [0]() { return 5; }
      set [0](input: number) { this.backing = input; }
      get child() { return { value: 1 }; }
    }
    function read(box: Box) { return box['value']; }
    function dot(box: Box) { return box.value; }
    function numeric(box: Box) { return box[0]; }
    function write(box: Box, input: number) { (box['value']) = input; }
    function numericWrite(box: Box, input: number) { ((box[0])) = input; }
    function erasedWrite(box: Box, input: number) { box.value! = input; }
    function compound(box: Box, input: number) { (box['value']) += input; }
    function update(box: Box) { (box['value'])++; }
    function remove(box: Box) { return delete (box['value']); }
    function removeDot(box: Box) { return delete ((box.value)); }
    function removeNested(box: Box) { return delete box.child.value; }
    function dynamic(box: Box, key: 'value') { return box[key]; }
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], { ts, checker, nodes, sourceFile, expressionFor } = doc;
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
  for (const name of ['read', 'dot', 'numeric']) {
    assert.deepEqual(callsFor(name).map(call => call.invocationKind), ['getter'], name + ' retains its source-backed getter');
    assert.equal(callsFor(name)[0].suppressResult, false);
  }
  for (const name of ['write', 'numericWrite', 'erasedWrite']) {
    assert.deepEqual(callsFor(name).map(call => call.invocationKind), ['setter'], name + ' is a reference assignment rather than a read');
    assert.equal(callsFor(name)[0].suppressResult, true);
    assert.equal(callsFor(name)[0].arguments.length, 1);
    const owner = sourceFile.statements.find(node => node.name?.text === name), assignment = owner.body.statements[0].expression;
    assert.deepEqual(callsFor(name)[0].arguments[0], expressionFor(assignment.right), 'transparent wrappers retain the actual RHS input');
  }
  for (const name of ['compound', 'update']) assert.deepEqual(callsFor(name).map(call => call.invocationKind), ['getter', 'setter']);
  for (const call of callsFor('update')) {
    const owner = sourceFile.statements.find(node => node.name?.text === 'update');
    assert.deepEqual(call.occurrence, expressionFor(owner.body.statements[0].expression),
      'the retained update operation owns both accessor invocations');
  }
  assert.ok(calls.every(call => call.occurrence), 'supported accessors must never emit a null call site');
  for (const name of ['remove', 'removeDot', 'dynamic']) assert.equal(callsFor(name).length, 0,
    name + ' cannot invent a property accessor from a deleted reference or the key binding symbol');
  assert.deepEqual(callsFor('removeNested').map(call => call.node.getText(sourceFile)), ['box.child'],
    'deleting an outer property still evaluates its receiver getter');
  assert.ok(calls.every(call => call.incompleteTargets && call.reason.includes('conservative')));

  fixture.group.flowDocuments[0].calls = calls;
  const added = await collectCompilerCrossFileFlow(fixture), partitions = [...fixture.syntaxPartitions, ...added];
  const store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const key = ref => ref.partitionId + ':' + ref.localId;
  const edges = [];
  for (const partition of added) for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(edge);
  for (const name of ['read', 'dot', 'numeric']) {
    const call = callsFor(name)[0];
    assert.ok(edges.some(edge => edge.kind === 'callTarget' && key(edge.callSite) === key(call.occurrence)
      && key(edge.to) === key(call.targets[0])), name + ' reaches the actual source accessor declaration');
    assert.ok(edges.some(edge => edge.kind === 'returnToResult' && key(edge.callSite) === key(call.occurrence)
      && key(edge.to) === key(call.result)), name + ' getter return crosses the retained call-owned result channel');
  }
  for (const name of ['write', 'numericWrite', 'erasedWrite']) {
    const call = callsFor(name)[0];
    assert.ok(edges.some(edge => edge.kind === 'argumentToParameter' && key(edge.callSite) === key(call.occurrence)
      && key(edge.from) === key(call.arguments[0])), name + ' RHS reaches the actual setter parameter');
    assert.ok(!edges.some(edge => edge.kind === 'returnToResult' && key(edge.callSite) === key(call.occurrence)),
      'a setter does not supply the assignment expression result');
  }
  console.log('accessor reference roles retain literal keys, wrapped writes and deletion receiver semantics');
} finally { await fs.rm(root, { recursive: true, force: true }); }
