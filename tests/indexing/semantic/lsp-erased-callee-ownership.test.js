import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createSemanticLspSession } from '../../../src/index/semantic/lsp-session.js';
import { mergeSemanticProviderOutput } from '../../../src/index/semantic/merge-provider.js';
import { joinProviderCallSummaries } from '../../../src/index/semantic/provider-call-joins.js';
import { offsetToLspPosition } from '../../../src/index/semantic/lsp-locations.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only. Actual retained syntax/LSP session/provider-summary consumers
// receive controlled definition data; no server, compiler/source process or RPC.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-erased-callee-'));
try {
  const text = `export function implementation(input: number) { return input; }
    type Callback = (input: number) => number;
    type Service = { run: Callback };
    declare const remote: Callback;
    declare const service: Service;
    declare function sink(value: Callback): void;
    (remote as Callback)(1);
    (remote satisfies Callback)(2);
    (<Callback>remote)(3);
    remote!(4);
    ((remote))(5);
    remote(6);
    (remote as Callback)?.(7);
    (service as Service).run(8);
    sink(remote as Callback);
    const stored = (remote satisfies Callback);
    (0, remote as Callback)(9);
  `;
  const fixture = await createCompilerBoundaryFixture(root, { 'input.ts': text }, {}, { withFlow: true });
  const doc = fixture.documents[0], { ts, sourceFile, expressionFor } = doc;
  const runtime = { root, buildRoot: root, semanticPolicy: fixture.policy };
  const session = await createSemanticLspSession({ state: fixture.state, runtime });
  const document = session.prepareDocuments([])[0], targets = await session.targetsForDocument(document);
  const key = ref => ref.partitionId + ':' + ref.localId;
  const callText = ['(remote as Callback)(1)', '(remote satisfies Callback)(2)', '(<Callback>remote)(3)',
    'remote!(4)', '((remote))(5)', 'remote(6)', '(remote as Callback)?.(7)', '(service as Service).run(8)'];
  const calls = callText.map(value => doc.nodes.find(node => ts.isCallExpression(node) && node.getText(sourceFile) === value));
  const selected = calls.map(node => {
    assert.ok(node);
    const target = targets.find(candidate => candidate.invocation && key(candidate.invocation.ref) === key(expressionFor(node))
      && ['remote', 'run'].includes(candidate.name));
    assert.ok(target, node.getText(sourceFile) + ' retains the canonical invocation behind erased value wrappers');
    assert.equal(target.invocation.kind, node.questionDotToken ? 'optionalCall' : 'call');
    return target;
  });
  const targetAt = (name, snippet) => {
    const start = text.indexOf(snippet), end = start + snippet.length;
    assert.ok(start >= 0);
    return targets.find(target => target.name === name && target.span[0] >= start && target.span[1] <= end);
  };
  assert.equal(targetAt('service', '(service as Service).run(8)').invocation, null, 'a wrapped member receiver is not the invoked method');
  assert.equal(targetAt('Callback', '(remote as Callback)(1)').invocation, null, 'an erased type operand is not the invoked value');
  assert.equal(targetAt('remote', 'sink(remote as Callback)').invocation, null, 'a wrapped argument is not its enclosing invocation callee');
  assert.equal(targetAt('remote', 'const stored = (remote satisfies Callback)').invocation, null);
  assert.equal(targetAt('remote', '(0, remote as Callback)(9)').invocation, null, 'comma expressions remain outside the transparent-wrapper policy');
  const uri = pathToFileURL(path.join(root, 'input.ts')).href, implementation = sourceFile.statements[0];
  const range = { start: offsetToLspPosition(doc.item.source, text, implementation.name.getStart(sourceFile), 'utf-16'),
    end: offsetToLspPosition(doc.item.source, text, implementation.name.end, 'utf-16') };
  await session.collectDocument({ doc: document, uri, targets: selected, requestDefinition: async () => ({
    attempted: true, payload: [{ uri, range }]
  }) });
  const output = session.output(), partitions = [...fixture.syntaxPartitions, ...output.partitions];
  const store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const edges = [];
  for (const partition of output.partitions) for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(edge);
  assert.equal(edges.filter(edge => edge.kind === 'callTarget').length, selected.length);
  for (const target of selected) assert.ok(edges.some(edge => edge.kind === 'callTarget'
    && key(edge.from) === key(target.invocation.ref) && key(edge.callSite) === key(target.invocation.ref)),
  'the retained provider edge belongs to the invocation rather than its wrapped identifier');
  await mergeSemanticProviderOutput({ output, state: fixture.state, runtime });
  fixture.group.flowDocuments[0].calls = calls.map(node => ({ occurrence: expressionFor(node), result: expressionFor(node),
    span: [node.getStart(sourceFile), node.end], targets: [], incompleteTargets: true,
    invocationKind: node.questionDotToken ? 'optionalCall' : 'call', arguments: node.arguments.map(expressionFor), hasSpread: false }));
  const joined = await joinProviderCallSummaries({ ...fixture, store, output });
  const joinedStore = fixture.storeFor([...partitions, ...joined]), flowEdges = [];
  await validateSemanticPartitions({ store: joinedStore, partitions: [...partitions, ...joined] });
  for (const partition of joined) for await (const edge of joinedStore.iterateRows(partition.partitionId, 'semantic_edges')) flowEdges.push(edge);
  for (const node of calls) {
    const site = expressionFor(node);
    assert.ok(flowEdges.some(edge => edge.kind === 'argumentToParameter' && key(edge.callSite) === key(site)
      && key(edge.from) === key(expressionFor(node.arguments[0]))));
    assert.ok(flowEdges.some(edge => edge.kind === 'returnToResult' && key(edge.callSite) === key(site)));
  }
  console.log('LSP erased callee ownership retains invocation-bound provider and summary channels');
} finally { await fs.rm(root, { recursive: true, force: true }); }
