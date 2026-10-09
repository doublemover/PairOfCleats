import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeHnswIndex} from '../../../tools/build/embeddings/hnsw.js';
const parent=process.env.PAIROFCLEATS_EMBEDDING_TEST_DIR||path.resolve('temp/tasks/retrieval-embedding-order');
await fs.mkdir(parent,{recursive:true});const folder=await fs.mkdtemp(path.join(parent,'graph-'));
const canonical=Array.from({length:6},(_,id)=>new Uint8Array([180+id,150-id,120+id,90-id]));
const hashes=[];
for(const order of [[5,3,1,4,2,0],[0,1,2,3,4,5]]){
  const vectors=Array(6);
  await Promise.all(order.map(async id=>{await Promise.resolve();vectors[id]=canonical[id];}));
  const indexPath=path.join(folder,'order-'+hashes.length+'.bin');
  const result=await writeHnswIndex({indexPath,metaPath:indexPath+'.meta.json',vectors,modelId:'fixture',
    dims:4,config:{enabled:true,randomSeed:100},quantization:{},scale:1,normalize:true,isolate:false,
    logger:{log(){},warn(message){console.log(message);}}});
  assert.equal(result.skipped,false,'Native HNSW must execute, not silently skip');
  assert.equal(result.count,6);
  hashes.push(createHash('sha256').update(await fs.readFile(indexPath)).digest('hex'));
}
assert.equal(hashes[0],hashes[1],'Canonical-ID insertion must not depend on file completion order');
console.log('Native fixed-seed HNSW output is identical across opposite file completion orders');
