import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { buildIndex } from '../../../src/integrations/core/build-index.js';
import { getIndexDir } from '../../../src/shared/repo-paths.js';
import { loadChunkMeta } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-incremental-parity-'));
const repo = path.join(temp,'repo'), clean = path.join(temp,'clean');
applyTestEnv({cacheRoot:path.join(temp,'cache'),embeddings:'off',testConfig:createFastIndexingTestConfig({
  indexing:{workerPool:{enabled:false},embeddings:{enabled:false,mode:'off'},lint:{enabled:false}},sqlite:{use:false}
})});
const write = async (name,text) => fs.writeFile(path.join(repo,name),text);
const build = root => buildIndex(root,{rawArgv:['--mode','code','--stage','stage2','--threads','1','--no-sqlite'],log:()=>{},logError:()=>{}});
const rows = async root => (await loadChunkMeta(getIndexDir(root,'code'))).map(row=>({
  file:row.file,name:row.name,kind:row.kind,start:row.start,end:row.end,tokens:row.tokens
})).sort((a,b)=>a.file.localeCompare(b.file)||a.start-b.start);
try {
  await fs.mkdir(repo);
  await write('edit.js','export function oldName() { return 1; }\n');
  await write('rename.js','export function movedName() { return 2; }\n');
  await write('delete.js','export function deletedName() { return 3; }\n');
  await build(repo);
  const before=await rows(repo); assert.ok(before.some(row=>row.name==='deletedName'));
  await write('edit.js','export function newName() { return 42; }\n');
  await fs.rename(path.join(repo,'rename.js'),path.join(repo,'moved.js'));
  await fs.rm(path.join(repo,'delete.js'));
  await build(repo);
  const incremental=await rows(repo);
  await fs.cp(repo,clean,{recursive:true});
  await build(clean);
  assert.deepEqual(incremental,await rows(clean),'edit/delete/rename match a fresh index of the resulting source');
  assert.ok(incremental.some(row=>row.name==='newName'));
  assert.ok(incremental.some(row=>row.file==='moved.js'));
  assert.ok(incremental.every(row=>row.file!=='delete.js'&&row.file!=='rename.js'&&row.name!=='oldName'));
  console.log(JSON.stringify({qualification:'three real stage2 builds; edit/delete/rename versus clean artifacts',chunks:incremental.length}));
} finally {await fs.rm(temp,{recursive:true,force:true});}
