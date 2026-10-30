import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJsonLinesFile,normalizeTfPostingRows } from '../../../src/storage/sqlite/build/from-artifacts/sources.js';
import { createMultiRowInserter } from '../../../src/storage/sqlite/build/multi-row.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(),'sqlite-source-contract-'));
try {
  const file=path.join(root,'rows.jsonl');await fs.writeFile(file,'{"id":1}\n{"id":2}\n');
  const order=[];
  await readJsonLinesFile(file,async row=>{if(row.id===1)await new Promise(resolve=>setImmediate(resolve));order.push(row.id);});
  assert.deepEqual(order,[1,2]);
  assert.deepEqual(normalizeTfPostingRows([[0,2.9],[1,-1]]),[[0,2]]);
  assert.deepEqual(normalizeTfPostingRows([[1,-1],[0,2.9]]),[[0,2]]);
  assert.deepEqual(normalizeTfPostingRows([['0','2'],[1,0]]),[[0,2]]);
  const inserted=[];
  const insert=createMultiRowInserter({prepare:()=>({run:(...args)=>inserted.push(args)})},{table:'test',columns:['a','b','n'],dedupeKeyIndices:[0,1],dedupeSumIndex:2});
  insert([['a\u001fb','c',1],['a','b\u001fc',2],['a\u001fb','c',3]]);
  assert.deepEqual(inserted.flat(),['a\u001fb','c',4,'a','b\u001fc',2]);
} finally {await fs.rm(root,{recursive:true,force:true});}
console.log('SQLite ordered callbacks and typed composite keys passed');
