import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createVfsManifestCollector } from '../../../src/index/build/vfs-manifest-collector.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
const root=resolveTestCachePath(process.cwd(),`vfs-concurrent-${crypto.randomUUID()}`);
const row=name=>({virtualPath:`${name}.js`,docHash:`hash-${name}`,containerPath:null,effectiveExt:'.js',languageId:'javascript'});
try {
  await fs.mkdir(root,{recursive:true});
  const collector=createVfsManifestCollector({buildRoot:root,maxBufferRows:1});
  await Promise.all([collector.appendRows([row('a')]),collector.appendRows([row('b')])]);
  const result=await collector.finalize();
  const rows=(await Promise.all(result.runs.map(file=>fs.readFile(file,'utf8')))).flatMap(text=>text.trim().split('\n').map(JSON.parse));
  assert.equal(rows.length,2);
  assert.equal(result.stats.totalRecords,rows.length);
  assert.equal(new Set(rows.map(value=>value.virtualPath)).size,2);
  await assert.rejects(collector.appendRows([row('late')]),/finalized/);
  await result.cleanup();
  const collectorB=createVfsManifestCollector({buildRoot:root,maxBufferRows:1});
  await collectorB.appendRows([row('c')]);
  const resultB=await collectorB.finalize();
  await result.cleanup();
  await fs.access(resultB.runs[0]);
  await resultB.cleanup();
} finally {await fs.rm(root,{recursive:true,force:true});}
console.log('VFS concurrent append passed');
