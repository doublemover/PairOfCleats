import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createCompilerTraceBackends } from '../../helpers/compiler-trace-backends.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { compilerCallAdapter } from '../../../src/index/semantic/compiler-call-adapter.js';
import { compilerInvocationTargets } from '../../../src/index/semantic/compiler-invocation.js';
import { createCompilerDispatchResolver } from '../../../src/index/semantic/compiler-dispatch.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-rest-context-'));
let backends;
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'rest.ts': `export {};
    function rest(...values:number[]){return values;}
    function mixed(prefix:number,...values:number[]){return values;}
    const first=rest(101),second=rest(202),empty=rest();
    const mixedFirst=mixed(0,301),mixedSecond=mixed(0,302);
    const appliedFirst=rest.apply(null,[401]),appliedSecond=rest.apply(null,[402]);
    const boundFirst=rest.bind(null,501),boundSecond=rest.bind(null,502);
    const boundResultFirst=boundFirst(),boundResultSecond=boundSecond();
    function mutate(...values:number[]){values[0]=9;return values;}
    const mutation=mutate(601);
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], { ts, checker, sourceFile, expressionFor } = doc;
  const declarationRef = node => {
    const anchor = node?.name || node;
    return anchor ? doc.item.declarations.get(anchor.getStart(sourceFile) + ':' + anchor.end)
      || (ts.isFunctionLike(node) ? expressionFor(node) : null) : null;
  };
  const dispatch = createCompilerDispatchResolver({ ts, checker, nodes: doc.nodes, declarationRef });
  const calls = [];
  for (const node of doc.nodes.filter(ts.isCallExpression)) {
    // bind itself creates a callable; its invocation is represented when used.
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'bind') continue;
    const adapter = compilerCallAdapter({ ts, checker, node, isDefaultLibrary: fixture.group.isDefaultLibrary });
    const targets = [declarationRef(checker.getResolvedSignature(node)?.declaration)].filter(Boolean);
    const selected = compilerInvocationTargets({ ts, checker, node, signature: checker.getResolvedSignature(node),
      declarationRef, targets, dispatch, adapter });
    calls.push({ occurrence: expressionFor(node), result: expressionFor(node), span: [node.getStart(sourceFile), node.end],
      targets: selected.targets, incompleteTargets: selected.incomplete, invocationKind: 'call',
      arguments: (adapter?.runtimeArguments || node.arguments).map(expressionFor), hasSpread: adapter?.hasSpread || false,
      receiver: adapter ? expressionFor(adapter.receiver) : null, unknownInputs: adapter?.unknownInputs.map(expressionFor) || [],
      reason: adapter?.reasons.join(';'), node });
  }
  const document = fixture.group.flowDocuments[0]; document.calls = calls;
  const added = await collectCompilerCrossFileFlow(fixture), partitions = [...fixture.syntaxPartitions, ...added];
  backends = await createCompilerTraceBackends(fixture, partitions);
  const call = text => calls.find(row => row.node.getText(sourceFile) === text), key = canonicalSemanticJson;
  for (const [firstText, secondText] of [['rest(101)', 'rest(202)'], ['mixed(0,301)', 'mixed(0,302)'],
    ['rest.apply(null,[401])', 'rest.apply(null,[402])'], ['boundFirst()', 'boundSecond()']]) {
    const first = call(firstText), second = call(secondText), ordinal = firstText.startsWith('mixed') ? 1 : 0;
    const forward = await backends.trace(first.arguments[ordinal]);
    assert.ok(forward.records.some(row => key(row.ref) === key(first.result)), firstText + ' reaches its own result');
    assert.ok(!forward.records.some(row => key(row.ref) === key(second.result)), firstText + ' never reaches another caller result');
    const reverse = await backends.trace(second.result, 'upstream');
    assert.ok(reverse.records.some(row => key(row.ref) === key(second.arguments[ordinal])));
    assert.ok(!reverse.records.some(row => key(row.ref) === key(first.arguments[ordinal])), secondText + ' never acquires another caller input');
  }
  const edges = [];
  for (const partition of added) for await (const edge of backends.artifact.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(edge);
  const first = call('rest(101)'), empty = call('rest()');
  const pack = edges.find(edge => edge.kind === 'packs' && key(edge.callSite) === key(first.occurrence));
  const entry = edges.find(edge => edge.kind === 'argumentToParameter' && key(edge.from) === key(pack.to));
  assert.ok(entry); assert.equal(key(entry.callSite), key(first.occurrence));
  assert.notEqual(key(pack.to), key(entry.to), 'packing targets a call-owned aggregate rather than the shared formal');
  assert.ok(edges.some(edge => edge.kind === 'argumentToParameter' && key(edge.callSite) === key(empty.occurrence)), 'empty rest calls still have one balanced aggregate transition');
  const mutationCoverage = [];
  for (const partition of added) for await (const row of backends.artifact.iterateRows(partition.partitionId, 'semantic_coverage')) mutationCoverage.push(row);
  assert.ok(mutationCoverage.some(row => row.reason.includes('rest_parameter_array_effect_mapping_unresolved')), 'rest mutation remains an explicit effect frontier');
  console.log('Call-owned rest aggregates balance positional/apply/bind/empty traces on both backends');
} finally { backends?.close(); await fs.rm(root, { recursive: true, force: true }); }
