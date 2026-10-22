/** A bounded-by-admission frontier: shallow, stronger witnesses execute first. */
export const createRiskStateQueue = () => {
  const heap = [];
  const compare = (a,b) => a.depth-b.depth || a.sanitizerBarriersHit-b.sanitizerBarriersHit
    || (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0);
  const push = state => {
    state.orderKey = JSON.stringify([state.rootSource.chunkUid,state.rootSource.source.ruleId,
      state.pathChunkUids,state.callSiteIdsByStep,state.taintKey]);
    heap.push(state);
    let index = heap.length-1;
    while (index>0) {
      const parent = Math.floor((index-1)/2);
      if (compare(heap[parent],heap[index])<=0) break;
      [heap[parent],heap[index]]=[heap[index],heap[parent]]; index=parent;
    }
  };
  const pop = () => {
    const first = heap[0],last = heap.pop();
    if (heap.length) {
      heap[0]=last;
      let index=0;
      for (;;) {
        let next=index;
        for (const child of [index*2+1,index*2+2]) if(child<heap.length&&compare(heap[child],heap[next])<0) next=child;
        if(next===index) break;
        [heap[next],heap[index]]=[heap[index],heap[next]];index=next;
      }
    }
    return first;
  };
  return {push,pop,get length(){return heap.length;},pending:()=>heap.slice()};
};
