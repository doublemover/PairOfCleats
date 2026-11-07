import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileRangeSync } from '../../../src/shared/file-read.js';
import { readTextFileWithStreamingCap } from '../../../src/index/build/file-processor/read.js';
const root = await fsp.mkdtemp(path.join(os.tmpdir(),'short-read-'));
const file = path.join(root,'sample.txt');
await fsp.writeFile(file,'abcdefghijklmnopqrstuvwxyz');
const readSync = fs.readSync,open = fsp.open;
try {
  fs.readSync = (fd,buffer,offset,length,position) => readSync(fd,buffer,offset,Math.min(2,length),position);
  assert.equal(readFileRangeSync(file,0,8).toString(),'abcdefgh');
  fsp.open = async (...args) => {
    const handle = await open(...args),read = handle.read.bind(handle);
    handle.read = (buffer,offset,length,position) => read(buffer,offset,Math.min(3,length),position);
    return handle;
  };
  const capped = await readTextFileWithStreamingCap({absPath:file,maxBytes:12});
  assert.equal(capped.text,'abcdefghijkl'); assert.equal(capped.truncated,true);
  const complete = await readTextFileWithStreamingCap({absPath:file,maxBytes:64});
  assert.equal(complete.text,'abcdefghijklmnopqrstuvwxyz'); assert.equal(complete.truncated,false);
} finally { fs.readSync=readSync;fsp.open=open;await fsp.rm(root,{recursive:true,force:true}); }
console.log('positive short reads complete bounded ranges passed');
