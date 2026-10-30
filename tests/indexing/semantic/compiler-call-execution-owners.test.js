import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { collectCompilerCrossFileFlow } from '../../../src/index/semantic/compiler-cross-file-flow.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only. Real CFG receipts feed the summary and retained call consumer;
// no source functions, constructors, default expressions or methods execute.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-call-execution-owners-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'owners.ts': `export {};
    function key(input: number) { return input; }
    function value(input: number) { return input; }
    function create(input: number) {
      const object = { [key(input)](argument = key(11)) { return value(argument); } };
      class Local { [key(input + 1)](argument = key(22)) { return value(argument + 1); } static field = key(33); }
      return object;
    }
    const top = { [key(100)]() { return 1; } };
  ` }, {}, { withFlow: true });
  const document = fixture.group.flowDocuments[0], doc = fixture.documents[0];
  const { ts, checker, sourceFile, nodes, expressionFor } = doc;
  const declarationRef = node => {
    const anchor = node.name || node;
    return doc.item.declarations.get(anchor.getStart(sourceFile) + ':' + anchor.end)
      || (ts.isFunctionLike(node) ? expressionFor(node) : null);
  };
  const calls = nodes.filter(ts.isCallExpression).map(node => ({ node, occurrence: expressionFor(node), result: expressionFor(node),
    span: [node.getStart(sourceFile), node.end], targets: [checker.getResolvedSignature(node)?.declaration].filter(Boolean).map(declarationRef).filter(Boolean),
    incompleteTargets: false, invocationKind: 'call', receiver: null, arguments: node.arguments.map(expressionFor), hasSpread: false }));
  assert.ok(calls.every(call => call.targets.length === 1));
  document.calls = calls;
  assert.equal(document.callExecutionOwnership, 'cfg');
  const key = canonicalSemanticJson, summaries = buildCallDependencySummaries([document]);
  assert.deepEqual(summaries.ownershipReasons, []);
  const owner = text => document.summaries.find(summary => summary.owner.getText(sourceFile).startsWith(text));
  const create = owner('function create'), method = owner('[key(input)]'), classMethod = owner('[key(input + 1)]'), topMethod = owner('[key(100)]');
  const callTexts = summary => summaries.functions.get(key(summary.declaration)).calls.map(call => call.node.getText(sourceFile)).sort();
  assert.deepEqual(callTexts(create), ['key(input)', 'key(input + 1)', 'key(33)'].sort(),
    'computed names and static initializer execute in the surrounding CFG');
  assert.deepEqual(callTexts(method), ['key(11)', 'value(argument)'].sort(), 'default/body calls stay with the object method');
  assert.deepEqual(callTexts(classMethod), ['key(22)', 'value(argument + 1)'].sort(), 'class method calls keep invocation ownership');
  assert.deepEqual(callTexts(topMethod), [], 'a module-evaluated key cannot become an uncalled method invocation');
  const byText = text => calls.find(call => call.node.getText(sourceFile) === text);
  const ownerRefs = text => document.callEffects.filter(route => key(route.result) === key(byText(text).result)).map(route => key(route.ownerRef));
  for (const text of ['key(input)', 'key(11)', 'key(100)']) assert.ok(ownerRefs(text).length > 0);
  assert.ok(ownerRefs('key(input)').every(ref => ref === key(create.ownerRef)));
  assert.ok(ownerRefs('key(11)').every(ref => ref === key(method.ownerRef)));
  assert.ok(ownerRefs('key(100)').every(ref => ref === key(document.summaries.find(summary => summary.owner === sourceFile).ownerRef)));

  const selected = byText('key(input)');
  const invalid = changes => buildCallDependencySummaries([{ ...document, ...changes }]);
  const missing = invalid({ callEffects: document.callEffects.filter(route => key(route.result) !== key(selected.result)) });
  assert.ok(missing.ownershipReasons.includes('call_execution_owner_unavailable_or_ambiguous'));
  assert.ok([...missing.functions.values()].every(summary => !summary.complete));
  assert.ok(![...missing.functions.values()].some(summary => summary.calls.some(call => key(call.result) === key(selected.result))),
    'missing canonical execution ownership cannot fall back to the method source span');
  const conflict = invalid({ callEffects: [...document.callEffects, { ...document.callEffects.find(route => key(route.result) === key(selected.result)), ownerRef: method.ownerRef }] });
  assert.ok(conflict.ownershipReasons.includes('call_execution_owner_unavailable_or_ambiguous'));
  assert.ok(![...conflict.functions.values()].some(summary => summary.calls.some(call => key(call.result) === key(selected.result))));

  const added = await collectCompilerCrossFileFlow(fixture), partitions = [...fixture.syntaxPartitions, ...added], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const edges = [];
  for (const partition of added) for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(edge);
  for (const text of ['key(input)', 'key(input + 1)', 'key(33)', 'key(11)', 'key(22)', 'key(100)', 'value(argument)', 'value(argument + 1)']) {
    const call = byText(text);
    assert.ok(edges.some(edge => edge.kind === 'returnToResult' && key(edge.callSite) === key(call.occurrence)
      && key(edge.to) === key(call.result)), text + ' keeps its actual retained result channel');
  }
  console.log('call summaries consume exact CFG execution owners for keys, static initializers, defaults and bodies');
} finally { await fs.rm(root, { recursive: true, force: true }); }
