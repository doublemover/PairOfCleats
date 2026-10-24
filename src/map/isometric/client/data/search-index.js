const grams=text=>{
  const keys=new Set();for(let index=0;index+3<=text.length;index++)keys.add(text.slice(index,index+3));return keys;
};

/** Bounded optional acceleration; unindexed rows always remain exactly searchable. */
export const createSnapshotSearchIndex = ({maxIndexBytes=8*1024*1024}={}) => {
  if(!Number.isSafeInteger(maxIndexBytes)||maxIndexBytes<0)throw new Error('Finite search-index retention budget required.');
  const rows=[],postings=new Map(),fallback=[];let retainedBytes=0,retired=false,sealed=false,indexedRows=0;
  const encoder=new TextEncoder();
  const live=()=>{if(retired)throw new Error('Snapshot search index has retired.');};
  return {
    admit(type,value){
      live();if(sealed)throw new Error('Snapshot search index is sealed.');
      const ordinal=rows.length;rows.push({type,value});
      // Long metadata is still queryable through the bounded cooperative fallback.
      const keys=value.search.length<=8192?grams(value.search):null;
      let bytes=0;
      if(keys)for(const key of keys)bytes+=4+(postings.has(key)?0:encoder.encode(key).length);
      if(!keys||retainedBytes+bytes>maxIndexBytes){fallback.push(ordinal);return;}
      for(const key of keys){if(!postings.has(key))postings.set(key,[]);postings.get(key).push(ordinal);}
      retainedBytes+=bytes;indexedRows++;
    },
    seal(){live();if(sealed)return;for(const [key,values]of postings)postings.set(key,Uint32Array.from(values));sealed=true;},
    *candidates(query){
      live();
      if(query.length<3){for(let ordinal=0;ordinal<rows.length;ordinal++)yield ordinal;return;}
      let shortest=null;
      for(const key of grams(query)){const values=postings.get(key)||[];if(shortest===null||values.length<shortest.length)shortest=values;if(!shortest.length)break;}
      // Merge source-local row order without allocating a whole-query candidate
      // array. Fallback rows cannot also occur in a posting list.
      let indexed=0,unindexed=0;
      const selected=shortest||[];
      while(indexed<selected.length||unindexed<fallback.length){
        if(unindexed>=fallback.length||(indexed<selected.length&&selected[indexed]<fallback[unindexed]))yield selected[indexed++];
        else yield fallback[unindexed++];
      }
    },
    row(ordinal){live();return rows[ordinal];},
    stats(){return {rows:rows.length,indexedRows,fallbackRows:fallback.length,retainedPostingAndKeyBytes:retainedBytes,heapBytes:'unmeasured'};},
    dispose(){retired=true;rows.length=0;postings.clear();fallback.length=0;}
  };
};
