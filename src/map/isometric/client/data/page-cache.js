/** Generation-local LRU. Byte accounting is serialized payload, not measured heap. */
export const createSnapshotPageCache = ({maxBytes=4*1024*1024,maxPages=64}={}) => {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isInteger(maxPages)||maxPages<1)throw new Error('Finite positive page-cache budgets required.');
  const pages=new Map();let bytes=0,evictions=0,retired=false;
  return {
    get(key){if(retired)throw new Error('Snapshot page cache has retired.');const value=pages.get(key);if(!value)return null;pages.delete(key);pages.set(key,value);return value.value;},
    set(key,value){
      if(retired)throw new Error('Snapshot page cache has retired.');
      const size=new TextEncoder().encode(JSON.stringify(value)).length;
      if(pages.has(key)){bytes-=pages.get(key).bytes;pages.delete(key);}
      if(size>maxBytes)return false;
      while(pages.size&&(pages.size>=maxPages||bytes+size>maxBytes)){const oldest=pages.keys().next().value;bytes-=pages.get(oldest).bytes;pages.delete(oldest);evictions++;}
      pages.set(key,{value,bytes:size});bytes+=size;return true;
    },
    stats(){return {pages:pages.size,retainedPayloadBytes:bytes,evictions,heapBytes:'unmeasured'};},
    clear(){pages.clear();bytes=0;},
    dispose(){retired=true;pages.clear();bytes=0;}
  };
};
