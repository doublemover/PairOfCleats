import assert from 'node:assert/strict';
import {runBatched} from '../../../tools/build/embeddings/embed.js';
import {createFileEmbeddingsProcessor} from '../../../tools/build/embeddings/pipeline.js';
const entry=text=>({items:[{index:0}],codeTexts:[text],docTexts:[],codeMapping:[0],docMapping:[]});
for(const reject of [false,true]){
  const processor=createFileEmbeddingsProcessor({
    embeddingBatchSize:4,runBatched,mode:'code',scheduleCompute:fn=>fn(),
    getChunkEmbeddings:async texts=>{await Promise.resolve();if(reject)throw Error('cancelled model request');return texts.map(()=>[1,2]);},
    assertVectorArrays:(vectors,count)=>assert.equal(vectors.length,count),
    processFileEmbeddings:async()=>{},globalMicroBatching:true,globalMicroBatchingMaxWaitMs:0,
    globalMicroBatchingMaxPending:4,globalMicroBatchingMaxPendingBytes:20
  });
  const outcomes=await Promise.allSettled(Array.from({length:8},()=>processor(entry('aa'))));
  await processor.drain();
  assert.ok(outcomes.every(result=>result.status===(reject?'rejected':'fulfilled')));
  const stats=processor.batchingStats();
  assert.equal(stats.pending,0);assert.equal(stats.pendingBytes,0);
  assert.equal(stats.peakPending,1);assert.equal(stats.peakPendingBytes,20);
  assert.ok(stats.waits>0);
  await assert.rejects(()=>processor(entry('oversized')),RangeError);
}
console.log('Microbatch admission respects retained-byte bounds and releases reservations on model cancellation/failure');
