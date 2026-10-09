/** Select a bounded evidence window before graph reranking fixes membership. */
export const selectDiverseEvidence = (entries, limit) => {
  const selected=[],deferred=[];
  const overlaps=(a,b)=>{
    const x=a.chunk,y=b.chunk;
    if(!x?.file||x.file!==y?.file)return false;
    if(![x.start,x.end,y.start,y.end].every(Number.isFinite))return false;
    const size=Math.min(x.end-x.start,y.end-y.start);
    return size>0 && Math.max(0,Math.min(x.end,y.end)-Math.max(x.start,y.start))/size>=0.8;
  };
  for(const [index,entry] of entries.entries()){
    const redundant=selected.some(other=>overlaps(entry,other));
    const comparableAlternative = redundant && entries.slice(index + 1).some(candidate => candidate.score >= entry.score - Math.abs(entry.score) * 0.1 && !selected.some(other => overlaps(candidate,other)));
    if(comparableAlternative)deferred.push(entry);else selected.push(entry);
    if(selected.length>=limit)break;
  }
  return selected.concat(deferred).slice(0,limit);
};
