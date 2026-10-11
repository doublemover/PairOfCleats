#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig, getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-compiler-bindings-'));
const repo = path.join(temp, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'lib.ts'), 'export function original(x: number) { return x + 1; } export {original as renamed};');
await fs.writeFile(path.join(repo, 'input.ts'), 'import {renamed as imported} from "./lib"; export function run() { const a = imported(1); const b = imported(2); { const imported = (x: number) => x * 2; imported(3); } return new Float32Array([a,b]); } export function movement(worker: Worker) { const buffer = new ArrayBuffer(32); const view = new Float32Array(buffer, 0, 4); const copy = new Float32Array([1,2]); const capture = () => view; const payload = {values:view, copy}; worker.postMessage(payload, [buffer]); return payload; }');
const dynamicText='function first(x:number,y:number){return x;} function second(x:number,y:number){return y;} export function alternatives(flag:boolean,a:number,b:number){const pick=flag?first:second;return pick(a,b);} class Base {run(x:number){return x;}} class Derived extends Base {run(x:number){return x+1;}} const receiver:Base=new Derived(); receiver.run(2);';
await fs.writeFile(path.join(repo,'dynamic.ts'),dynamicText);
// Exercise eager cold/warm completion under a bounded allowance for the entire build process.
applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'stub', testConfig: {
  indexing: { ...(process.env.POC_SEMANTIC_FIXTURE_WORKER_POOL === 'off' ? { workerPool: { enabled: false } } : {}), semantic: { enabled: true, profile: 'rich', execution: { compilerAdmission: { maxResidentBytes: 2147483648 } }, enrichment: { bindings: 'eager', localFlow: 'eager', crossFileFlow: 'eager' } }, embeddings: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, treeSitter: { enabled: false } }
} });
try {
  await buildIndex(repo, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
  const indexDir = getIndexDir(repo, 'code', loadUserConfig(repo));
  const manifest = JSON.parse(await fs.readFile(path.join(indexDir, 'semantic_manifest.json'), 'utf8'));
  const { store } = await openPublishedSemanticStore({ indexDir, repoRoot: repo, generation: manifest.generation });
  const records = new Map(), edges = [], coverage = [], sourcePaths=new Map();
  for (const partition of manifest.partitions) {
    for await(const source of store.iterateRows(partition.partitionId,'semantic_sources'))sourcePaths.set(partition.partitionId,source.path);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.set(partition.partitionId + ':' + row.id, row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  assert.ok([...records.values()].some(row => row.kind === 'binding'), 'compiler bindings persist with type inference disabled');
  assert.ok(edges.some(row => row.kind === 'aliases'), 'renamed import/re-export chain persists across an export occurrence without a declaration row');
  const calls = edges.filter(row => row.kind === 'callTarget' && sourcePaths.get(row.from.partitionId)==='input.ts' && records.get(row.to.partitionId + ':' + row.to.localId)?.kind === 'declaration').sort((a,b) => a.from.localId - b.from.localId);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].to, calls[1].to);
  assert.notEqual(calls[0].to.partitionId, calls[0].from.partitionId, 'renamed import resolves to library source, not the import binding');
  assert.notDeepEqual(calls[1].to, calls[2].to, 'shadowed binding is distinct');
  assert.notDeepEqual(calls[0].from, calls[1].from, 'same target retains each occurrence');
  assert.ok(edges.some(row => row.kind === 'constructTarget'));
  const dynamicCalls=edges.filter(edge=>edge.kind==='callTarget'&&sourcePaths.get(edge.from.partitionId)==='dynamic.ts');
  const callText=edge=>{const span=records.get(edge.from.partitionId+':'+edge.from.localId)?.span;return span?dynamicText.slice(...span):null;};
  const alternatives=dynamicCalls.filter(edge=>callText(edge)==='pick(a,b)');
  assert.equal(alternatives.length,2,'production compiler session preserves both callable alternatives');
  assert.ok(alternatives.every(edge=>edge.certainty==='modeled'));
  assert.ok(dynamicCalls.some(edge=>callText(edge)==='receiver.run(2)'&&edge.certainty==='modeled'),'production member dispatch stays modeled');
  const returned = edges.filter(row => row.kind === 'returnToResult');
  assert.ok(returned.length >= 3, 'resolved local/imported calls retain return channels: ' + JSON.stringify({ returned, flowCoverage: coverage.filter(row => row.phase === 'crossFileFlow') }));
  assert.ok(returned.every(row => row.callSite && row.certainty === 'modeled'));
  const importedReturns=calls.slice(0,2).map(call=>returned.filter(row=>row.callSite.partitionId===call.from.partitionId&&row.callSite.localId===call.from.localId));
  assert.ok(importedReturns.every(rows=>rows.length>0),'each imported invocation has its own return channel');
  assert.notDeepEqual(importedReturns[0][0].callSite,importedReturns[1][0].callSite,'return channels retain call occurrences independently of partition ordering or multiple candidates');
  assert.ok(edges.some(row => row.kind === 'argumentToParameter'), 'each resolved positional argument has its parameter edge');
  assert.ok(edges.some(row => row.kind === 'captures'), 'closure retains immutable lexical capture');
  assert.ok(edges.some(row => row.kind === 'sharesStorage'), 'typed-array view retains storage relation');
  assert.ok(edges.some(row => row.kind === 'copies'), 'array constructor input retains copy relation');
  assert.ok(edges.some(row => row.kind === 'transfers'), 'transfer request is modeled separately');
  const dispatch = [...records.entries()].find(([, row]) => row.kind === 'boundary' && row.data.boundaryKind === 'message-dispatch-request');
  assert.ok(dispatch);
  const viewEdge = edges.find(row => row.kind === 'sharesStorage');
  const visited = new Set(), pending = [viewEdge.from];
  while (pending.length) {
    const from = pending.pop(), key = from.partitionId + ':' + from.localId;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const edge of edges) if (edge.from.partitionId === from.partitionId && edge.from.localId === from.localId
      && ['sharesStorage','defines','reads','packs','consumes'].includes(edge.kind)) pending.push(edge.to);
  }
  assert.ok(visited.has(dispatch[0]), 'buffer input -> view -> packed property -> dispatch consumer witness');
  assert.ok(coverage.some(row => row.phase === 'localFlow' && row.state === 'partial'));
  assert.ok([...records.values()].some(row => row.kind === 'externalDeclaration' && row.data.uri.includes('lib.')));
  assert.ok(coverage.some(row => row.phase === 'bindings' && ['complete','partial'].includes(row.state)));
  const control = new Database(path.join(getRepoCacheRoot(repo, loadUserConfig(repo)), 'semantic-frontier', 'control.sqlite'), { readonly: true });
  try {
    assert.ok(manifest.completedTasks.length > 0);
    for (const receipt of manifest.completedTasks) assert.equal(control.prepare('SELECT state FROM tasks WHERE taskId=?').get(receipt.taskId).state, 'completed', 'completion follows successful normal generation promotion');
  } finally { control.close(); }
  await buildIndex(repo, { mode: 'code', stage: 'stage2', incremental: true, 'stub-embeddings': true, 'scm-provider': 'none' });
  const warmDir = getIndexDir(repo, 'code', loadUserConfig(repo));
  const warm = JSON.parse(await fs.readFile(path.join(warmDir, 'semantic_manifest.json'), 'utf8'));
  assert.notEqual(warm.generation.baseBuildId, manifest.generation.baseBuildId);
  assert.deepEqual(warm.partitions.filter(p => p.partitionId.startsWith('sy1:')).map(p => p.canonicalHash).sort(),
    manifest.partitions.filter(p => p.partitionId.startsWith('sy1:')).map(p => p.canonicalHash).sort(), 'warm reuse retains exact immutable syntax');
  const {store:warmStore}=await openPublishedSemanticStore({indexDir:warmDir,repoRoot:repo,generation:warm.generation});
  const warmBindings=[],warmTargets=[];
  for(const partition of warm.partitions){
    for await(const row of warmStore.iterateRows(partition.partitionId,'semantic_records'))if(row.kind==='binding')warmBindings.push(JSON.stringify(row));
    for await(const row of warmStore.iterateRows(partition.partitionId,'semantic_edges'))if(row.kind==='callTarget')warmTargets.push(JSON.stringify(row));
  }
  assert.deepEqual(warmBindings.sort(),[...records.values()].filter(row=>row.kind==='binding').map(row=>JSON.stringify(row)).sort(),'warm cache retains checker observations without requiring redundant task execution');
  assert.deepEqual(warmTargets.sort(),edges.filter(row=>row.kind==='callTarget').map(row=>JSON.stringify(row)).sort(),'warm cache retains exact call targets');
  assert.ok(warm.completedTasks.every(receipt => receipt.baseBuildId === warm.generation.baseBuildId));

} finally { await fs.rm(temp, { recursive: true, force: true }); }
console.log('compiler binding production passed');
