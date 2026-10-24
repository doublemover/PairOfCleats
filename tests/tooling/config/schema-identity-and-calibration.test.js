import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readShippedConfigSchema } from '../../../tools/dict-utils/config.js';
import { runStartupCalibrationProbe } from '../../../src/index/build/runtime/platform-preset.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'schema-calibration-'));
try{
  const schemaPath=path.join(root,'schema.json');await fs.writeFile(schemaPath,'{"type":"object"}');
  const first=readShippedConfigSchema(schemaPath);assert.equal(first,readShippedConfigSchema(schemaPath));
  assert.throws(()=>{first.type='string';},TypeError);
  await fs.writeFile(schemaPath,'{"type":"string"}');await fs.utimes(schemaPath,new Date(),new Date(Date.now()+1000));
  const second=readShippedConfigSchema(schemaPath);assert.notEqual(second,first);assert.equal(second.type,'string');
  const probes=await Promise.all(Array.from({length:8},()=>runStartupCalibrationProbe({cacheRoot:root})));
  assert.ok(probes.every(probe=>!probe.error));
  assert.deepEqual(await fs.readdir(path.join(root,'runtime-calibration')),[]);
}finally{await fs.rm(root,{recursive:true,force:true});}
console.log('stable shipped schema identity and invocation-owned calibration passed');
