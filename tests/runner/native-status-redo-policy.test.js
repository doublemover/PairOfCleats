import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from './run-args.js';
import { runTests } from './run-execution.js';
const savedArgv=process.argv;
try{
  process.argv=[process.execPath,'tests/run.js'];
  assert.equal(parseArgs()['native-status-redo'],true);
  process.argv=[process.execPath,'tests/run.js','--native-status-redo=false','--retries','0'];
  assert.equal(parseArgs()['native-status-redo'],false);
}finally{process.argv=savedArgv;}
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-native-redo-policy-'));
try{
  const script=path.join(root,'child.mjs'),marker=path.join(root,'marker');
  await fs.writeFile(script,'import fs from "node:fs"; const marker=process.env.REDO_POLICY_MARKER; if(!fs.existsSync(marker)){fs.writeFileSync(marker,"first");process.exit(3221225477);} console.log("explicit redo complete");');
  const test={id:'native-exit-policy',path:script,relPath:'child.mjs'};
  const logs=path.join(root,'logs');await fs.mkdir(logs);
  const context={jobs:1,root,baseEnv:{...process.env,REDO_POLICY_MARKER:marker},passThrough:[],timeoutMs:5000,captureOutput:true,retries:0,runLogDir:logs,timeoutGraceMs:100,skipExitCode:77,maxOutputBytes:4096,redoExitCodes:[]};
  const [disabled]=await runTests({selection:[test],context});
  assert.equal(disabled.status,'failed');assert.equal(disabled.attempts,1);
  assert.equal(disabled.logs.filter(file=>file.endsWith('.log')).length,1);
  assert.ok(disabled.logs.some(file=>file.endsWith('.failure.json')),'first failure receipt is retained');
  await fs.rm(marker);
  const [enabled]=await runTests({selection:[{...test,id:'native-exit-default'}],context:{...context,redoExitCodes:process.platform==='win32'?[3221225477]:[5]}});
  assert.equal(enabled.status,'passed');assert.equal(enabled.attempts,2);
  console.log('Explicit native-status redo disable preserves first failure; default redo remains available.');
}finally{await fs.rm(root,{recursive:true,force:true});}
