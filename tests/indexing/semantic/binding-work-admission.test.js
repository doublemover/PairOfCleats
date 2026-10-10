#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { persistCompilerAdmissionDeferral } from '../../../src/index/semantic/compiler-admission-evidence.js';
import { planCompilerAdmission } from '../../../src/index/semantic/compiler-admission.js';
import { createCompilerDependencySystem } from '../../../src/index/semantic/compiler-dependencies.js';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareSemanticBindingWork } from '../../../src/index/semantic/build-frontier.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { createBindingWorkFixture } from '../../helpers/semantic-binding-work.js';

for (const bindings of ['eager']) {
  const fixture = await createBindingWorkFixture({ bindings });
  try {
    const work = await prepareSemanticBindingWork({ state: fixture.state, runtime: fixture.runtime });
    const result = await work.run(fixture.emitBindings);
    assert.equal(result.ran, true);
    assert.deepEqual(fixture.state.semanticCompletedTasks, result.receipts);
    const control = fixture.openControl();
    try {
      assert.equal(control.getTask(work.task.taskId).state, 'leased', 'durable analysis is not completed before normal publication');
      assert.equal(control.getOutput(work.task.taskId), null);
    } finally { control.close(); }
    assert.ok([...fixture.state.semanticFactsByFile.values()].some(entry => entry.partitions.some(partition => partition.members.semantic_frontier.length)),
      'checker outputs retain the immutable pending task partition');
  } finally { await fixture.cleanup(); }
}
const unknown = await createBindingWorkFixture({bindings:'auto'});
try {
  const work=await prepareSemanticBindingWork({state:unknown.state,runtime:unknown.runtime});
  let called=false;
  const result=await work.run(()=>{called=true;throw new Error('Unknown automatic cost must not run a Program.');});
  assert.equal(result.ran,false);assert.equal(called,false);assert.deepEqual(result.receipts,[]);
  assert.equal(work.task.sourceUnits.length,2,'regression requires one task owning two source units');
  const root=path.join(unknown.buildRoot,unknown.storage.relativePath);
  const selected=[{task:work.task,phase:'bindings',policy:unknown.runtime.semanticPolicy,root,generation:unknown.generation}];
  const decision=planCompilerAdmission({inventory:await unknown.state.semanticCompilerPreflight,
    policy:unknown.runtime.semanticPolicy.execution.compilerAdmission,schedulerStats:unknown.runtime.scheduler.stats(),runtimeHash:'f'.repeat(64)});
  assert.equal(decision.reason,'compiler_analysis_cost_unknown');
  const before=new Map([...unknown.state.semanticFactsByFile].map(([file,descriptor])=>[file,new Set(descriptor.partitions.map(partition=>partition.partitionId))]));
  await persistCompilerAdmissionDeferral({state:unknown.state,runtime:unknown.runtime,selected,decision});
  const added=[];
  for(const [file,descriptor]of unknown.state.semanticFactsByFile){
    const fresh=descriptor.partitions.filter(partition=>!before.get(file).has(partition.partitionId));
    assert.equal(fresh.length,1,'one coverage partition is selected per source');
    assert.equal(fresh[0].sourceUnitId,descriptor.sourceUnitId);
    const store=createArtifactSemanticStore({root,repoRoot:unknown.repoRoot,generation:unknown.generation,artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,partitions:descriptor.partitions});
    const rows=[];for await(const row of store.iterateRows(fresh[0].partitionId,'semantic_coverage'))rows.push(row);
    assert.equal(rows.length,1);assert.equal(rows[0].scope.sourceUnitId,descriptor.sourceUnitId);
    assert.equal(rows[0].frontierRef,work.task.taskId);assert.equal(rows[0].reason,decision.reason);
    added.push(fresh[0]);
  }
  assert.equal(new Set(added.map(partition=>partition.partitionId)).size,2,'group deferral IDs include each distinct source scope');
  const firstSelection=new Map([...unknown.state.semanticFactsByFile].map(([file,descriptor])=>[file,descriptor.partitions.map(partition=>[partition.partitionId,partition.canonicalHash])]));
  await persistCompilerAdmissionDeferral({state:unknown.state,runtime:unknown.runtime,selected,decision});
  for(const [file,descriptor]of unknown.state.semanticFactsByFile){
    assert.deepEqual(descriptor.partitions.map(partition=>[partition.partitionId,partition.canonicalHash]),firstSelection.get(file),'identical replay preserves selected IDs/counts/hashes');
    assert.equal(new Set(descriptor.partitions.map(partition=>partition.partitionId)).size,descriptor.partitions.length,'replay selects no duplicate partition');
  }
  if(process.platform==='win32'){
    const probeRoot=path.join(unknown.root,'ProbeCase');await fs.mkdir(probeRoot);
    await fs.writeFile(path.join(probeRoot,'FileOne.ts'),'export const one=1;');await fs.mkdir(path.join(probeRoot,'ChildDirectory'));
    const {ts}=prepareTypeScriptSyntax('',{ext:'.ts'}),captured=createCompilerDependencySystem({ts});
    captured.system.readDirectory(probeRoot.toUpperCase(),['.ts'],undefined,['**/*']);
    captured.system.getDirectories(probeRoot.toUpperCase());captured.system.realpath(probeRoot.toUpperCase());
    const replay=createCompilerDependencySystem({ts,inventory:{observations:[...captured.observations.values()]}}).system;
    assert.doesNotThrow(()=>replay.readDirectory(probeRoot.toLowerCase(),['.ts'],undefined,['**/*']),'equivalent Windows path casing preserves sealed directory authority');
    assert.doesNotThrow(()=>replay.getDirectories(probeRoot.toLowerCase()));assert.doesNotThrow(()=>replay.realpath(probeRoot.toLowerCase()));
    await fs.writeFile(path.join(probeRoot,'FileTwo.ts'),'export const two=2;');
    assert.throws(()=>replay.readDirectory(probeRoot.toLowerCase(),['.ts'],undefined,['**/*']),{code:'ERR_SEMANTIC_DEPENDENCY_UNSEALED'},'real directory membership changes remain blocked');
    await fs.mkdir(path.join(probeRoot,'AnotherChild'));
    assert.throws(()=>replay.getDirectories(probeRoot.toLowerCase()),{code:'ERR_SEMANTIC_DEPENDENCY_UNSEALED'});
  }
  const control=unknown.openControl();try{assert.equal(control.getOutput(work.task.taskId),null);}finally{control.close();}
}finally{await unknown.cleanup();}
const partial = await createBindingWorkFixture({ bindings: 'deferred', deferredDrain: 'after-index' });
try {
  partial.runtime.semanticEnrichmentDrain={maxMs:30000,admitTask:async({task})=>task.kind==='bind'};
  const work = await prepareSemanticBindingWork({ state: partial.state, runtime: partial.runtime });
  assert.equal((await work.run(args => partial.emitBindings({ ...args, onlyFirst: true }))).reason, 'compiler_phase_source_inventory_incomplete');
  assert.equal(partial.state.semanticCompletedTasks?.length || 0, 0);
  const control = partial.openControl();
  try { assert.equal(control.getTask(work.task.taskId).state, 'pending'); } finally { control.close(); }
} finally { await partial.cleanup(); }
const budget = await createBindingWorkFixture({ bindings: 'deferred', deferredDrain: 'after-index', afterIndexMaxMs: 5 });
try {
  budget.runtime.semanticEnrichmentDrain={maxMs:5,admitTask:async()=>true};
  const work = await prepareSemanticBindingWork({ state: budget.state, runtime: budget.runtime });
  const result = await work.run(async ({ signal }) => {
    await new Promise(resolve => setTimeout(resolve, 15)); throwIfAborted(signal);
    return budget.emitBindings({ signal });
  });
  assert.equal(result.reason, 'analysis_budget_exhausted');
  assert.equal(budget.state.semanticCompletedTasks?.length || 0, 0);
  const control = budget.openControl();
  try { assert.equal(control.getTask(work.task.taskId).state, 'pending'); } finally { control.close(); }
} finally { await budget.cleanup(); }
console.log('binding scheduler admission, complete output receipts, partial inventory and cooperative deadline preserve pending work');
