/** A supplied real adapter may reorder existing evidence, never introduce members. */
export const rerankEvidence = async ({adapter,query,hits,signal,maxMs=2000}) => {
  if(!adapter)return hits;
  if(!adapter.id||typeof adapter.rerank!=='function')throw new TypeError('Reranker requires id and rerank');
  if(hits.length>64)throw new RangeError('Reranker evidence window exceeds 64');
  const controller=new AbortController();
  const cancel=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  let timer;
  try {
    const result=await Promise.race([
      Promise.resolve().then(()=>adapter.rerank({query,hits,signal:controller.signal})),
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Reranker deadline exceeded'));},Math.max(1,Math.min(10000,maxMs)));})
    ]);
    if(controller.signal.aborted)throw new Error('Reranker cancelled');
    if(!Array.isArray(result)||result.length!==hits.length)throw new TypeError('Reranker must score each evidence member');
    const scores=new Map();
    for(const entry of result){
      if(!Number.isInteger(entry?.index)||entry.index<0||entry.index>=hits.length||scores.has(entry.index)||!Number.isFinite(entry.score))throw new TypeError('Invalid reranker evidence scores');
      scores.set(entry.index,entry.score);
    }
    return hits.map((hit,index)=>({...hit,sourceScore:hit.score,sourceScoreType:hit.scoreType,score:scores.get(index),scoreType:'model_rerank',reranker:adapter.id,__rank:index}))
      .sort((a,b)=>b.score-a.score||a.__rank-b.__rank).map(({__rank,...hit})=>hit);
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
};
