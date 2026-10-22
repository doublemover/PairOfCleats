import assert from 'node:assert/strict';
import { readExactAt } from '../../../src/shared/io/read-exact.js';
const source=Buffer.from('abcdef');
for(const cap of [1,2,6]){
 const positions=[];const handle={async read(buffer,offset,length,position){positions.push(position);const bytes=Math.min(cap,length,source.length-position);source.copy(buffer,offset,position,position+bytes);return {bytesRead:bytes};}};
 const target=Buffer.alloc(8,0x78);assert.equal((await readExactAt(handle,target,1,6,0)).bytesRead,6);assert.equal(target.toString(),'xabcdefx');assert.equal(positions[0],0);
 const eof=Buffer.alloc(8);assert.equal((await readExactAt(handle,eof,0,8,0)).bytesRead,6);
}
await assert.rejects(readExactAt({read:async()=>({bytesRead:2})},Buffer.alloc(1),0,1,0),{code:'ERR_IO_READ_PROGRESS'});
await assert.rejects(readExactAt({read:async()=>({bytesRead:-1})},Buffer.alloc(1),0,1,0),{code:'ERR_IO_READ_PROGRESS'});
const controller=new AbortController();let reads=0;await assert.rejects(readExactAt({read:async()=>{reads++;controller.abort();return {bytesRead:1};}},Buffer.alloc(2),0,2,0,{signal:controller.signal}),{name:'AbortError'});assert.equal(reads,1);
console.log('positioned read owner fills positive short reads and preserves EOF, cancellation, and bounds');
