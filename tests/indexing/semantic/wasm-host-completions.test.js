import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { wasmModule, wasmHostFixture } from '../../helpers/wasm-fixture.js';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-wasm-completions-'));
const sourceBytes=bytes=>'new Uint8Array(['+[...bytes]+'])';
try {
  const multi=wasmModule({types:[{params:[0x7f],results:[0x7f,0x7f]}],imports:[{module:'env',name:'chosen'}],functions:[{code:[0x20,0,0x10,0]}],exports:[{name:'run',index:1}]});
  const memory=wasmModule({imports:[{module:'env',name:'mem',kind:2,descriptor:[0,1]}],functions:[{code:[0x20,0]}],exports:[{name:'run',index:0},{name:'mem',kind:2,index:0}]});
  const fixture=await createCompilerBoundaryFixture(root,{'host.ts':`export {};
    const chosen=(x:number)=>{try{return x+1;}finally{return x+2;}};
    const suppressed=(x:number)=>{try{return x;}finally{throw 9;}};
    const module=new WebAssembly.Module(${sourceBytes(wasmHostFixture())});
    const instance=new WebAssembly.Instance(module,{env:{chosen}}); instance.exports.run(1);
    new WebAssembly.Instance(module,{env:{chosen:suppressed}}).exports.run(2);
    new WebAssembly.Instance(new WebAssembly.Module(${sourceBytes(multi)}),{env:{chosen:(x:number)=>[x,x+1]}}).exports.run(3);
    const mem=new WebAssembly.Memory({initial:1}); const shared=new WebAssembly.Instance(new WebAssembly.Module(${sourceBytes(memory)}),{env:{mem}});const exported=shared.exports.mem;
  `}, {}, {withFlow:true});
  const {group,state,policy,syntaxPartitions,storeFor}=fixture;
  const partitions=await collectCompilerBoundaryFlow({group,state,policy}),store=storeFor([...syntaxPartitions,...partitions]);
  const records=new Map(),edges=[];const key=ref=>ref.partitionId+':'+ref.localId;
  for(const p of [...syntaxPartitions,...partitions]) {
    for await(const row of store.iterateRows(p.partitionId,'semantic_records'))records.set(p.partitionId+':'+row.id,row);
    for await(const edge of store.iterateRows(p.partitionId,'semantic_edges'))edges.push(edge);
  }
  const hostReturns=edges.filter(edge=>edge.kind==='returnToResult'&&records.get(key(edge.from))?.span&&records.get(key(edge.to))?.data.origin==='return');
  assert.ok(hostReturns.some(edge=>fixture.documents[0].sourceFile.text.slice(...records.get(key(edge.from)).span).includes('return x+2')),'finally override uses existing compiler completion summary');
  assert.ok(!hostReturns.some(edge=>fixture.documents[0].sourceFile.text.slice(...records.get(key(edge.from)).span).includes('return x+1')));
  assert.ok(edges.some(edge=>edge.kind==='throws'&&records.get(key(edge.to))?.data.blockKind==='exception'&&records.get(key(edge.from))?.span));
  assert.ok(hostReturns.some(edge=>edge.operandOrdinal===1),'multi-value host arrays keep positional return channels');
  assert.ok(edges.filter(edge=>edge.kind==='sharesStorage'&&records.get(key(edge.to))?.data.boundaryKind==='wasm-module-memory').length>=2,'import and export storage views link through module identity');
  console.log('WASM compiler completion summaries, finally overrides, multi-value returns and host memory links passed');
} finally {await fs.rm(root,{recursive:true,force:true});}
