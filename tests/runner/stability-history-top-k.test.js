import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadStabilityHistory } from './run-stability.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'stability-top-k-'));
try{
  for(let index=19;index>=0;index-=1)await fs.writeFile(path.join(root,`${19-index}.json`),JSON.stringify({schemaVersion:1,generatedAt:new Date(index*1000).toISOString(),tests:[{id:`test-${index}`}]}));
  await fs.writeFile(path.join(root,'malformed.json'),'{');
  const result=await loadStabilityHistory({historyDir:root,historyLimit:3});
  assert.deepEqual(result.artifacts.map(value=>value.tests[0].id),['test-19','test-18','test-17']);
}finally{await fs.rm(root,{recursive:true,force:true});}
console.log('bounded newest stability history selection passed');
