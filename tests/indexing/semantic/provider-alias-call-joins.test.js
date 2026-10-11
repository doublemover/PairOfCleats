import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { joinProviderCallSummaries } from '../../../src/index/semantic/provider-call-joins.js';
import { writeSemanticAnalysis } from '../../../src/index/semantic/analysis-write.js';
import { createAnalysisPartitionId } from '../../../src/index/semantic/identity.js';
import { mergeSemanticProviderOutput } from '../../../src/index/semantic/merge-provider.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-provider-alias-'));
try {
  const text = 'export function implementation(value:number){return value;} declare const remote:(value:number)=>number; ' + Array.from({ length: 11 }, (_, index) => `remote(${index});`).join('');
  const f = await createCompilerBoundaryFixture(root, { 'input.ts': text }, {}, { withFlow: true });
  const doc = f.documents[0], flow = f.group.flowDocuments[0], contextKey = 'b'.repeat(64);
  const implementation = flow.summaries.find(summary => summary.declaration).declaration;
  const calls = doc.nodes.filter(node => doc.ts.isCallExpression(node));
  flow.calls = calls.map(call => ({ occurrence: doc.expressionFor(call), result: doc.expressionFor(call), span: [call.getStart(), call.end], targets: [], incompleteTargets: true,
    arguments: call.arguments.map(doc.expressionFor), invocationKind: 'call', hasSpread: false }));
  const partitionId = createAnalysisPartitionId({ pass: { name: 'provider-alias-fixture', version: '1' }, inputPartitionHashes: [doc.bindingPartition.canonicalHash], compilerContext: contextKey, dependencySummaryHashes: [], analysisPolicy: {} });
  const ref = localId => ({ partitionId, localId });
  const rows = [{ family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
    data: { method: 'explicit-provider-declaration-alias', producerId: 'fixture', producerVersion: '1', evidenceKind: 'static-analysis', sourceRef: doc.item.source.sourceUnitId, artifactRef: null } } }];
  let nodeId = 1, edgeId = 0;
  const external = () => {
    const value = ref(nodeId++);
    rows.push({ family: 'node', row: { id: value.localId, kind: 'externalDeclaration', span: null, scope: null,
      data: { contextKey, uri: 'file:///unavailable/rpc.d.ts', packageName: null, packageVersion: null, nameId: 0, declarationKind: 'provider-location', sourceHash: null, sourceRange: null } } });
    return value;
  };
  const edge = (kind, from, to, extra = {}) => rows.push({ family: 'edge', row: { id: edgeId++, kind, from, to, callSite: null, operandOrdinal: null, contextKey, condition: null, evidence: ref(0), certainty: 'exact-static', ...extra } });
  const targets = calls.map((call, index) => {
    const target = external();
    edge(index === 6 ? 'constructTarget' : 'callTarget', doc.expressionFor(call), target, { callSite: doc.expressionFor(call) });
    return target;
  });
  const bridge = external();
  edge('aliases', targets[0], bridge); edge('aliases', bridge, implementation);
  edge('aliases', implementation, targets[1]); // Direction cannot be reversed.
  edge('aliases', targets[2], implementation, { certainty: 'modeled' });
  edge('aliases', targets[3], implementation, { evidence: null });
  edge('aliases', targets[4], implementation, { contextKey: 'c'.repeat(64) });
  // Target 5 has an external location, but no source/body authority.
  edge('aliases', targets[6], implementation); // Wrong invocation kind.
  edge('aliases', targets[7], targets[7]); edge('aliases', targets[7], implementation);
  const value = ref(nodeId++);
  rows.push({ family: 'node', row: { id: value.localId, kind: 'value', span: null, scope: null, data: { origin: 'unknown', site: targets[8], storage: null } } });
  edge('aliases', targets[8], value); edge('aliases', value, implementation);
  for (const [index, depth] of [[9, 8], [10, 9]]) {
    let previous = targets[index];
    for (let step = 1; step < depth; step += 1) { const next = external(); edge('aliases', previous, next); previous = next; }
    edge('aliases', previous, implementation);
  }
  rows.push({ family: 'lookup', row: { kind: 'name', id: 0, value: 'remote' } });
  const partition = await writeSemanticAnalysis({ rows, policy: f.policy, stagingRoot: f.stagingRoot, source: doc.item.source, sourceBytes: doc.bytes, partitionId,
    producerHash: 'd'.repeat(64), contextHash: contextKey, policyHash: 'a'.repeat(64), structuralSlots: [], diskAccount: f.state.semanticDiskAccount });
  const output = { schemaVersion: 1, contexts: [{ contextKey, providerId: 'fixture', providerVersion: '1', compilerVersion: null, configHash: 'e'.repeat(64), moduleResolutionHash: 'f'.repeat(64), vfsMappingHash: '0'.repeat(64), sourceUnits: [{ sourceUnitId: doc.item.source.sourceUnitId, byteHash: doc.item.source.byteHash }] }], partitions: [partition], coverageRef: null, diagnosticsRef: null };
  await mergeSemanticProviderOutput({ output, state: f.state, runtime: { root, buildRoot: root } });
  const joined = await joinProviderCallSummaries({ ...f, output, store: f.storeFor([...f.syntaxPartitions, partition]) });
  const store = f.storeFor(joined), returns = [], coverage = [];
  for (const joinedPartition of joined) {
    for await (const row of store.iterateRows(joinedPartition.partitionId, 'semantic_edges')) if (row.kind === 'returnToResult') returns.push(row);
    for await (const row of store.iterateRows(joinedPartition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  for (let index = 0; index < calls.length; index += 1) assert.equal(returns.some(row => row.callSite.localId === flow.calls[index].occurrence.localId), [0, 7, 9].includes(index), `source summary join for case ${index}`);
  assert.ok(coverage.some(row => row.reason.includes('unknown_call_return_remainder')), 'external candidates never erase unknown runtime effects');
  assert.ok(coverage.some(row => row.reason.includes('provider_call_join_budget')), 'depth truncation is visible');
  console.log('Bounded provider declaration-alias joins retain external, direction, evidence and invocation boundaries');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
