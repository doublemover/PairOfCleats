import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCompilerBoundaryFixture} from '../../helpers/compiler-boundary-fixture.js';
import {createCompilerTraceBackends} from '../../helpers/compiler-trace-backends.js';
import {collectCompilerValueSlice} from '../../../src/index/semantic/compiler-value-slice.js';
import {collectCompilerStorageFlow} from '../../../src/index/semantic/compiler-storage-flow.js';
import {collectCompilerCrossFileFlow} from '../../../src/index/semantic/compiler-cross-file-flow.js';
import {buildCallDependencySummaries} from '../../../src/index/semantic/compiler-call-summaries.js';
import {canonicalSemanticJson as key} from '../../../src/index/semantic/identity.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-pr557-ordered-aggregate-'));let backends;
try {
  const fixture=await createCompilerBoundaryFixture(root,{'probe.ts':[
    'function direct(x:number){return new Uint8Array([x]);}',
    'function local(x:number){const buffer=new Uint8Array([x]);return buffer;}',
    'function view(x:number){const buffer=new Uint8Array([x]);return buffer.subarray();}',
    'function copy(x:number){const buffer=new Uint8Array([x]);return buffer.slice();}',
    'function indexed(x:number){const buffer=new Uint8Array([x]);return buffer[0];}',
    'function outside(x:number){const buffer=new Uint16Array([x]);return buffer.subarray();}',
    'function nested(x:number){const buffer=new Uint8Array([x,2,3]);const view=buffer.subarray(1);return view.slice();}',
    'function changed(x:number,y:number){const buffer=new Uint8Array([x]);const view=buffer.subarray();buffer[0]=y;return view;}',
    'function overwritten(x:number,y:number){const buffer=new Uint8Array([x]);buffer[0]=y;return buffer;}',
    'function overwrittenView(x:number,y:number){const buffer=new Uint8Array([x]);buffer[0]=y;return buffer.subarray();}',
    'function excluded(x:number){const buffer=new Uint8Array([x,2]);return buffer.subarray(1);}',
    'function empty(x:number){const buffer=new Uint8Array([x]);return buffer.subarray(1);}'
  ].join('\n')},{},{withFlow:true});
  const doc=fixture.documents[0],flow=fixture.group.flowDocuments[0];
  const args={...doc,source:doc.item.source,root:fixture.stagingRoot,context:fixture.group.context,isDefaultLibrary:fixture.group.isDefaultLibrary,diskAccount:fixture.state.semanticDiskAccount};
  const slice=await collectCompilerValueSlice({...args,orderedOperations:flow.orderedOperations,orderedAccesses:flow.orderedAccesses});
  const storage=await collectCompilerStorageFlow({...args,orderedAccesses:flow.orderedAccesses});
  const partitions=[...fixture.syntaxPartitions,slice.partition,storage.partition,...await collectCompilerCrossFileFlow(fixture)];
  backends=await createCompilerTraceBackends(fixture,partitions);
  const summaries=buildCallDependencySummaries([flow]);
  for (const owner of flow.summaries.filter(row => row.parameters?.length)) {
    const name = owner.owner.name.text, trace = await backends.trace(owner.parameters[0]);
    const reaches = trace.records.some(row => key(row.ref) === key(owner.returns[0]));
    const excluded = ['nested', 'excluded', 'empty'].includes(name);
    const overwritten = ['changed', 'overwritten', 'overwrittenView'].includes(name);
    assert.equal(reaches, !excluded && !overwritten, name + ' aggregate retains only supported element inputs');
    if (name !== 'outside' && !excluded && !overwritten) assert.ok(summaries.functions.get(key(owner.declaration)).dependencies.has(0));
    if (reaches) {
      const reverse = await backends.trace(owner.returns[0], 'upstream');
      assert.ok(reverse.records.some(row => key(row.ref) === key(owner.parameters[0])));
    }
    if (overwritten) {
      assert.deepEqual([...summaries.functions.get(key(owner.declaration)).dependencies], [1], 'overwritten input is absent from the aggregate summary');
      const changed = await backends.trace(owner.parameters[1]);
      assert.ok(changed.records.some(row => key(row.ref) === key(owner.returns[0])), 'a later write reaches a returned live view');
    }
  }
  console.log('Returned typed arrays and live views retain aggregate inputs with drained artifact/SQLite parity');

}finally{backends?.close();await fs.rm(root,{recursive:true,force:true});}
