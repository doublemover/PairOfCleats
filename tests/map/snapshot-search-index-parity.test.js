import assert from 'node:assert/strict';
import { createSnapshotSearchIndex } from '../../src/map/isometric/client/data/search-index.js';
import { createGraphStore } from '../../src/map/isometric/client/data/graph-store.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';

const rows=Array.from({length:4000},(_,i)=>({id:`opaque:${i}:😀`,search:`file/${i}.ts unique${i} 日本語:${i} 😀`.toLowerCase()}));
for(const maxIndexBytes of [0,1024,8*1024*1024]){
  const index=createSnapshotSearchIndex({maxIndexBytes});for(const row of rows)index.admit('member',row);index.seal();
  for(const query of ['','a','😀','unique3999','日本語:300','does-not-occur','file/3']){
    const expected=rows.filter(row=>row.search.includes(query)).map(row=>row.id);
    const actual=[...index.candidates(query)].map(ordinal=>index.row(ordinal).value).filter(row=>row.search.includes(query)).map(row=>row.id);
    assert.deepEqual(actual,expected,`exact source-order substring parity under index budget ${maxIndexBytes}`);
  }
  if(maxIndexBytes>1024)assert.ok([...index.candidates('unique3999')].length<rows.length,'posting admission narrows exact candidates without dropping fallback rows');
  assert.ok(index.stats().retainedPostingAndKeyBytes<=maxIndexBytes);index.dispose();
  assert.throws(()=>[...index.candidates('query')],/retired/);
}
const manifest={protocol:MAP_DATA_PROTOCOL,snapshot:'source:a',counts:{files:1,members:2,edges:1},coverage:{upstreamDropped:null}};
const store=createGraphStore(manifest);
store.admit('files',[{path:'typed.ts',name:'typed',memberCount:2}]);
store.admit('members',[{file:'typed.ts',id:0,name:'numeric',ordinal:0},{file:'typed.ts',id:'0',name:'string',ordinal:1}]);
store.admit('edges',[{row:0,type:'call',from:{member:0},to:{member:'0'}}]);store.finish();
assert.equal((await store.search({query:'numeric'})).rows[0].id,0);
assert.equal((await store.search({query:'string'})).rows[0].id,'0');
assert.equal(store.adjacency({type:'member',id:0},{direction:'incoming'}).rows.length,0);
assert.equal(store.adjacency({type:'member',id:'0'},{direction:'incoming'}).rows.length,1);
store.dispose();
const rich=createGraphStore({protocol:MAP_DATA_PROTOCOL,snapshot:'source:wide',counts:{files:1,members:4,edges:0},coverage:{upstreamDropped:null}});
rich.admit('files',[{path:'wide.ts',memberCount:4}]);
rich.admit('members',Array.from({length:4},(_,ordinal)=>({file:'wide.ts',ordinal,id:`wide:${ordinal}`,name:'large '+String(ordinal)+'x'.repeat(100000)})));rich.finish();
const firstPage=await rich.search({query:'large',limit:4});assert.equal(firstPage.rows.length,2);assert.equal(firstPage.total,4);assert.equal(firstPage.next,2);
const secondPage=await rich.search({query:'large',cursor:firstPage.next,limit:4});assert.equal(secondPage.rows.length,2);assert.equal(secondPage.next,null);
assert.equal(secondPage.rows[0].id,'wide:2','byte-limited search continuation cannot skip a match');rich.dispose();
const filtered=createGraphStore({protocol:MAP_DATA_PROTOCOL,snapshot:'source:filtered',counts:{files:1,members:1000,edges:0},coverage:{upstreamDropped:null}});
filtered.admit('files',[{path:'filtered.ts',memberCount:1000}]);
filtered.admit('members',Array.from({length:1000},(_,ordinal)=>({file:'filtered.ts',ordinal,id:ordinal,name:`member${ordinal}`})));filtered.finish();
const filteredAbort=new AbortController();let filteredYields=0;
await assert.rejects(filtered.search({query:'',entityType:'file',signal:filteredAbort.signal,yieldTask:async()=>{
  filteredYields++;filteredAbort.abort();
}}),error=>error.name==='AbortError');
assert.equal(filteredYields,1,'excluded entity types still count toward cooperative source work');
await assert.rejects(filtered.search({query:'missing',cursor:1}),/matching total/);
filtered.dispose();
console.log('Bounded search postings retain exact fallback, typed identity, source order and substring parity.');
