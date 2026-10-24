/** A bounded-by-admission frontier: shallow, stronger witnesses execute first. */
export const createRiskStateQueue = () => {
  const heap = [];
  const compare = (a,b) => a.depth-b.depth || a.sanitizerBarriersHit-b.sanitizerBarriersHit
    || (a.rootOrderKey < b.rootOrderKey ? -1 : a.rootOrderKey > b.rootOrderKey ? 1 : 0)
    || compareRiskWitnesses(a.witness, b.witness)
    || (a.taintOrderKey < b.taintOrderKey ? -1 : a.taintOrderKey > b.taintOrderKey ? 1 : 0);
  const push = state => {
    state.rootOrderKey = JSON.stringify([state.rootSource.chunkUid,state.rootSource.source.ruleId]);
    state.taintOrderKey = JSON.stringify(state.taintKey ?? null);
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
import { compareRiskWitnesses } from './witness.js';

