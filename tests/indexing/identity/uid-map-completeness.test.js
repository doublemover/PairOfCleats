import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBaseIndex } from '../validate/helpers.js';
import { reconcileIndexIdentity } from '../../../src/index/identity/reconcile.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
const root=resolveTestCachePath(process.cwd(),`uid-map-completeness-${crypto.randomUUID()}`);
try {
  const {indexDir,manifest}=await createBaseIndex({rootDir:root,chunkMeta:[{id:0,file:'a.js'},{id:1,file:'b.js'}]});
  const chunks=JSON.parse(await fs.readFile(path.join(indexDir,'chunk_meta.json'),'utf8'));
  await fs.writeFile(path.join(indexDir,'chunk_uid_map.json'),JSON.stringify([{docId:0,chunkUid:chunks[0].chunkUid,file:chunks[0].file}]));
  manifest.pieces.push({name:'chunk_uid_map',path:'chunk_uid_map.json',format:'json',count:1});
  await fs.writeFile(path.join(indexDir,'pieces','manifest.json'),JSON.stringify(manifest));
  const result=await reconcileIndexIdentity({indexDir,strict:true});
  assert.equal(result.ok,false);
  assert.equal(result.issues.some(issue=>issue.code==='ERR_ID_CHUNK_UID_MAP_DOC_ID_OMITTED'&&issue.docId===1),true);
  assert.equal(result.issues.some(issue=>issue.code==='ERR_ID_CHUNK_UID_MAP_UID_MISMATCH'),false,
    'the valid first mapping does not hide the omitted second row');
  await fs.writeFile(path.join(indexDir,'chunk_uid_map.json'),JSON.stringify(chunks.map((row,docId)=>({docId,chunkUid:row.chunkUid,file:row.file}))));
  manifest.pieces.find(piece=>piece.name==='chunk_uid_map').count=2;
  await fs.writeFile(path.join(indexDir,'pieces','manifest.json'),JSON.stringify(manifest));
  const healthy=await reconcileIndexIdentity({indexDir,strict:true});
  assert.equal(healthy.ok,true,JSON.stringify(healthy.issues));
} finally {await fs.rm(root,{recursive:true,force:true});}
console.log('UID map reverse coverage passed');
