import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCompilerBoundaryFixture} from '../../helpers/compiler-boundary-fixture.js';
import {collectCompilerWorkerFlow} from '../../../src/index/semantic/compiler-worker-flow.js';
import {validateSemanticPartitions} from '../../../src/index/semantic/reconcile.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-node-worker-'));
try {
  const fixture=await createCompilerBoundaryFixture(root,{
    'host.ts':`import {Worker,MessageChannel} from 'node:worker_threads';
      declare function consume(value:unknown):void;
      const worker=new Worker(new URL('./worker.ts',import.meta.url),{workerData:{amount:3}});
      worker.on('message',(response)=>consume(response));worker.postMessage({value:4});
      const {port1,port2}=new MessageChannel();port2.once('message',value=>consume(value));port1.postMessage(9);
      const isolated=new MessageChannel();isolated.port1.postMessage(10);
      const dynamic=new Worker(new URL('./worker.ts',import.meta.url),{eval:true});dynamic.postMessage(11);`,
    'worker.ts':`import {parentPort,workerData} from 'node:worker_threads';
      declare function consume(value:unknown):void;consume(workerData);
      parentPort!.on('message',value=>{consume(value);parentPort!.postMessage(value);});`,
    'fake.ts':`export {};class Worker {on(name:string,fn:(value:any)=>void){} postMessage(value:any){}}const fake=new Worker();fake.on('message',value=>console.log(value));fake.postMessage(12);`
  });
  const partitions=await collectCompilerWorkerFlow(fixture),all=[...fixture.syntaxPartitions,...partitions],store=fixture.storeFor(all);
  await validateSemanticPartitions({store,partitions:all});
  const records=new Map(),edges=[],coverage=[];const key=ref=>ref.partitionId+':'+ref.localId;
  for(const partition of all) {
    for await(const row of store.iterateRows(partition.partitionId,'semantic_records'))records.set(partition.partitionId+':'+row.id,row);
    for await(const row of store.iterateRows(partition.partitionId,'semantic_edges'))edges.push(row);
    for await(const row of store.iterateRows(partition.partitionId,'semantic_coverage'))coverage.push(row);
  }
  const deliveries=edges.filter(edge=>edge.kind==='dispatches'&&records.get(key(edge.from))?.data.boundaryKind==='node-worker-message-dispatch-request'&&records.get(key(edge.to))?.data.boundaryKind==='node-worker-message-consumer-candidate');
  assert.equal(deliveries.length,3,'host-to-worker, worker-to-host and opposite Node port joins');
  assert.ok(deliveries.every(edge=>edge.certainty==='modeled'));
  const nodeRecords=[...records.values()].filter(row=>row.data.boundaryKind?.startsWith('node-worker'));
  assert.ok(nodeRecords.some(row=>row.data.boundaryKind==='node-worker-data-clone-request'));
  const dataConsumers=edges.filter(edge=>edge.kind==='consumes'&&records.get(key(edge.from))?.data.boundaryKind==='node-worker-construction-request');
  assert.equal(dataConsumers.length,1,'workerData joins the retained worker use, not import syntax');
  assert.ok(coverage.some(row=>row.reason?.includes('node_worker_dynamic_or_eval_options')));
  assert.ok(coverage.some(row=>row.reason?.includes('node_worker_peer_or_consumer_unresolved')));
  const fake=fixture.documents.find(doc=>doc.item.file==='fake.ts');
  assert.ok(!partitions.some(partition=>partition.sourceUnitId===fake.item.source.sourceUnitId),'local platform-name lookalikes receive no Node model');
  console.log('Node Worker, workerData, direct message payloads, reverse replies and MessageChannel joins passed');
} finally {await fs.rm(root,{recursive:true,force:true});}
