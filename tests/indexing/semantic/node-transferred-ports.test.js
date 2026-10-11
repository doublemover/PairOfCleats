import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCompilerBoundaryFixture} from '../../helpers/compiler-boundary-fixture.js';
import {collectCompilerWorkerFlow} from '../../../src/index/semantic/compiler-worker-flow.js';
import {validateSemanticPartitions} from '../../../src/index/semantic/reconcile.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-transferred-ports-'));
try {
  const fixture=await createCompilerBoundaryFixture(root,{
    'channel.ts':`import {MessageChannel} from 'node:worker_threads';export const channel=new MessageChannel();`,
    'host.ts':`import {Worker,MessageChannel} from 'node:worker_threads';import {channel} from './channel';
      const extra=new MessageChannel();const worker=new Worker(new URL('./worker.ts',import.meta.url),{workerData:{extra:extra.port2},transferList:[extra.port2]});
      extra.port1.on('message',value=>console.log(value));channel.port1.on('message',value=>console.log(value));
      worker.postMessage({port:channel.port2},[channel.port2]);worker.postMessage({missing:channel.port1});channel.port1.postMessage(42);`,
    'worker.ts':`import {parentPort,workerData} from 'node:worker_threads';
      workerData.extra.postMessage(8);
      parentPort!.on('message',payload=>{payload.port.on('message',value=>{console.log(value);payload.port.postMessage(value);});payload.missing.on('message',value=>console.log(value));const port='unobserved';payload[port].on('message',value=>console.log(value));});`
  });
  const added=await collectCompilerWorkerFlow(fixture),all=[...fixture.syntaxPartitions,...added],store=fixture.storeFor(all);
  await validateSemanticPartitions({store,partitions:all});
  const rows=new Map(),edges=[],key=ref=>ref.partitionId+':'+ref.localId;
  for(const partition of all){for await(const row of store.iterateRows(partition.partitionId,'semantic_records'))rows.set(partition.partitionId+':'+row.id,row);for await(const edge of store.iterateRows(partition.partitionId,'semantic_edges'))edges.push(edge);}
  const deliveries=edges.filter(edge=>edge.kind==='dispatches'&&rows.get(key(edge.from))?.data.boundaryKind==='node-worker-message-dispatch-request'&&rows.get(key(edge.to))?.data.boundaryKind==='node-worker-message-consumer-candidate');
  assert.equal(deliveries.length,5,'two worker sends, transferred port delivery/reply and workerData port delivery');
  const transferred=[...rows.values()].filter(row=>row.data.boundaryKind==='node-worker-transferred-port-candidate');
  assert.equal(transferred.length,2,'workerData and message-carried ports retain explicit transfer provenance');
  const worker=fixture.documents.find(doc=>doc.item.file==='worker.ts');
  assert.ok(![...rows.values()].some(row=>row.kind==='boundary'&&row.span&&worker.sourceFile.text.slice(...row.span).startsWith('payload.missing.on')),'a port omitted from the transfer list acquires no endpoint identity');
  assert.ok(deliveries.every(edge=>edge.certainty==='modeled'));
  console.log('Cross-file and transferred Node port identity candidates passed');
}finally{await fs.rm(root,{recursive:true,force:true});}
