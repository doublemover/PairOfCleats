import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerAliasAssignments, createCompilerFieldPaths } from '../../../src/index/semantic/compiler-flow-fields.js';
import { createCompilerDispatchResolver } from '../../../src/index/semantic/compiler-dispatch.js';
import { compilerClassDefinitions } from '../../../src/index/semantic/compiler-object-model.js';
import { compilerCallAdapter } from '../../../src/index/semantic/compiler-call-adapter.js';
import { compilerInvocationInputs, compilerInvocationTargets } from '../../../src/index/semantic/compiler-invocation.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only: actual checker/alias/dispatch/field owners and retained rows.
// Fixture functions, prototype writes, constructors and adapters are not run.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-transparent-aliases-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'aliases.ts': `export {};
    type Callback = (input: number) => number;
    function first(input: number) { return input; }
    function second(input: number) { return input + 1; }
    function run() {
      let mutable: Callback = first; ((mutable)) = second; mutable(1);
      const left = { call: first }, right = { call: second };
      let receiver = left; (receiver as typeof left) = (right satisfies typeof right); receiver.call(2);
      (first satisfies Callback)(3);
      const holder = { call: first }; ((holder.call)) = second; holder.call(4);
      const cell = ({ value: 17 } satisfies { value: number }); const read = cell.value;
      return read;
    }
    class Left { value = 117; call(input: number) { return input; } }
    class Right { value = 129; call(input: number) { return input + 1; } }
    const Choice = (Left satisfies new () => Left);
    let MutableCtor = Choice; ((MutableCtor)) = (Right satisfies new () => Right);
    new MutableCtor().call(5);
    class Patched { call(input: number) { return input; } }
    ((Patched.prototype).call) = second; new Patched().call(6);
    const bound = (first.bind(undefined, 7) satisfies () => number); bound();
    first.apply(undefined, ([8] satisfies [number]));
    first.apply(undefined, (<[number]>[9]));
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], { ts, checker, nodes, sourceFile, expressionFor } = doc;
  const declarationRef = node => {
    const anchor = node.name || node;
    return doc.item.declarations.get(anchor.getStart(sourceFile) + ':' + anchor.end)
      || (ts.isFunctionLike(node) ? expressionFor(node) : null);
  };
  const key = ref => ref.partitionId + ':' + ref.localId;
  const named = name => sourceFile.statements.find(node => node.name?.text === name);
  const refs = names => new Set(names.map(name => key(declarationRef(named(name)))));
  const assignments = collectCompilerAliasAssignments(ts, checker, nodes);
  const mutable = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'mutable');
  assert.deepEqual(assignments.get(checker.getSymbolAtLocation(mutable.name)).map(node => node.getText(sourceFile)), ['second'],
    'the existing shared inventory indexes the actual binding behind a wrapped assignment target');
  const dispatch = createCompilerDispatchResolver({ ts, checker, nodes, declarationRef });
  const byText = new Map(nodes.filter(ts.isCallExpression).map(node => [node.getText(sourceFile), node]));
  const direct = text => dispatch(byText.get(text));
  for (const text of ['mutable(1)', 'receiver.call(2)', 'holder.call(4)']) {
    assert.deepEqual(new Set(direct(text).targets.map(key)), refs(['first', 'second']), text + ' retains both source may candidates');
    assert.equal(direct(text).incomplete, true);
  }
  assert.deepEqual(new Set(direct('(first satisfies Callback)(3)').targets.map(key)), refs(['first']));
  const methods = new Set(['Left', 'Right'].map(name => key(declarationRef(named(name).members.find(ts.isMethodDeclaration)))));
  assert.deepEqual(new Set(direct('new MutableCtor().call(5)').targets.map(key)), methods);
  assert.ok(direct('new MutableCtor().call(5)').reasons.includes('mutable_class_binding_order_and_escape_conservative'));
  assert.ok(direct('new Patched().call(6)').targets.some(ref => key(ref) === key(declarationRef(named('second')))),
    'a wrapped prototype receiver retains the source patch');
  const choice = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'Choice');
  assert.deepEqual(compilerClassDefinitions({ ts, checker, node: choice.initializer, assignments, reasons: new Set() }), [named('Left')]);
  const owner = named('run'), reasons = new Set();
  const fields = createCompilerFieldPaths({ ts, checker, owner, sourceFile, assignments, expressionFor,
    declarationFor: declarationRef, depthLimit: 8, reasons });
  const read = nodes.find(node => ts.isPropertyAccessExpression(node) && node.getText(sourceFile) === 'cell.value');
  const initial = nodes.find(node => ts.isNumericLiteral(node) && node.text === '17');
  assert.ok(fields.locationsFor(read).some(location => location.initializers.some(ref => key(ref) === key(expressionFor(initial)))),
    'a satisfies wrapper preserves its actual allocation and field initializer');

  const adapt = text => compilerCallAdapter({ ts, checker, node: byText.get(text), isDefaultLibrary: fixture.group.isDefaultLibrary });
  assert.deepEqual(adapt('bound()').runtimeArguments.map(node => node.getText(sourceFile)), ['7']);
  assert.deepEqual(adapt('first.apply(undefined, ([8] satisfies [number]))').runtimeArguments.map(node => node.getText(sourceFile)), ['8']);
  assert.deepEqual(adapt('first.apply(undefined, (<[number]>[9]))').runtimeArguments.map(node => node.getText(sourceFile)), ['9']);
  const selected = ['mutable(1)', 'receiver.call(2)', 'holder.call(4)', 'new MutableCtor().call(5)', 'new Patched().call(6)',
    'bound()', 'first.apply(undefined, ([8] satisfies [number]))', 'first.apply(undefined, (<[number]>[9]))'];
  const calls = selected.map(text => {
    const node = byText.get(text), adapter = adapt(text);
    const resolved = compilerInvocationTargets({ ts, checker, node, signature: checker.getResolvedSignature(node),
      declarationRef, targets: [], dispatch, adapter });
    return { node, occurrence: expressionFor(node), span: [node.getStart(sourceFile), node.end], targets: resolved.targets,
      incompleteTargets: resolved.incomplete, invocationKind: 'call', receiver: expressionFor(adapter?.receiver
        || (ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : null)),
      arguments: (adapter?.runtimeArguments || compilerInvocationInputs(ts, node).runtimeArguments).map(expressionFor),
      unknownInputs: (adapter?.unknownInputs || []).map(expressionFor), result: expressionFor(node), hasSpread: adapter?.hasSpread || false };
  });
  fixture.group.flowDocuments[0].calls = calls;
  const added = await collectCompilerCrossFileFlow(fixture), partitions = [...fixture.syntaxPartitions, ...added], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const edges = [];
  for (const partition of added) for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(edge);
  for (const text of selected.slice(0, 4)) {
    const call = calls.find(candidate => candidate.node.getText(sourceFile) === text);
    for (const target of call.targets) assert.ok(edges.some(edge => edge.kind === 'callTarget'
      && key(edge.callSite) === key(call.occurrence) && key(edge.to) === key(target)), text + ' retains each call-owned source target');
    assert.equal(edges.filter(edge => edge.kind === 'returnToResult' && key(edge.callSite) === key(call.occurrence)).length, 2);
  }
  for (const text of selected.slice(5)) {
    const call = calls.find(candidate => candidate.node.getText(sourceFile) === text);
    assert.ok(edges.some(edge => edge.kind === 'argumentToParameter' && key(edge.callSite) === key(call.occurrence)
      && key(edge.from) === key(call.arguments[0]) && key(edge.to) === key(declarationRef(named('first').parameters[0]))),
    text + ' retains the actual adapted argument rather than the erased wrapper or array aggregate');
  }
  console.log('transparent compiler aliases retain assignment, class, field, prototype and adapted call consumers');
} finally { await fs.rm(root, { recursive: true, force: true }); }
