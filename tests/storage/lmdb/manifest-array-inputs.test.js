import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadLmdbOptionalArray } from '../../../src/storage/lmdb/optional-arrays.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
const root=resolveTestCachePath(process.cwd(),`lmdb-manifest-arrays-${crypto.randomUUID()}`);
try {
  await fs.mkdir(root,{recursive:true});
  for(const [name,row] of [['file_meta',{id:0,file:'a.js',ext:'.js'}],['field_tokens',{name:['alpha']}]]) {
    const part=`${name}.part-00000.jsonl`;await fs.writeFile(path.join(root,part),JSON.stringify(row)+'\n');
    const manifest={artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,pieces:[{name,path:part,format:'jsonl',count:1}]};
    assert.deepEqual(await loadLmdbOptionalArray(root,name,manifest),[row]);
    await fs.rm(path.join(root,part));
    await assert.rejects(loadLmdbOptionalArray(root,name,manifest));
  }
  assert.equal(await loadLmdbOptionalArray(root,'file_meta',{pieces:[]}),null);
} finally {await fs.rm(root,{recursive:true,force:true});}
console.log('LMDB manifest array inputs passed');
