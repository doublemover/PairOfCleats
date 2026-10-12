#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { inspectOnnx, readBounded, hashFile, withinTrialRoot, writeNbitsDerivative } from './eg2-qualify-graph.js';
import { qualifyRetrieval, summarizeOrtProfile } from './eg2-qualify-quality.js';

const SCHEMA='eg2.cpu-trial.v1';
export function validateTrialIdentity(identity) {
  if(identity?.provider!=='cpu')throw new Error('Qualification trial provider must be CPU.');
  for(const key of ['modelRevision','modelSha256','tokenizerSha256','graphSha256','runtimeVersion','dtype','documentPrefix','queryPrefix','chunkerIdentity'])
    if(typeof identity[key]!=='string'||!identity[key])throw new Error('Complete numerical/input identity required: '+key);
  if(!/^[a-f0-9]{40}$/.test(identity.modelRevision))throw new Error('Pinned model revision required.');
  for(const key of ['modelSha256','tokenizerSha256','graphSha256'])if(!/^[a-f0-9]{64}$/.test(identity[key]))throw new Error('Artifact SHA256 required: '+key);
  if(!Number.isInteger(identity.dimensions)||identity.dimensions<1||identity.dimensions>8192)throw new Error('Dimensions required.');
  if(!Number.isInteger(identity.maxLength)||identity.maxLength<1||identity.maxLength>8192)throw new Error('Explicit truncation ceiling required.');
  return identity;
}
export async function appendTrialReceipt(root, receipt) {
  const marker=JSON.parse(await readBounded(path.join(root,'trial-manifest.json'),1024*1024));
  if(marker.schema!==SCHEMA)throw new Error('Dedicated CPU trial directory required.');
  validateTrialIdentity(marker.identity);
  const dbPath=await withinTrialRoot(path.join(root,'qualification.sqlite'),root);
  const database=new Database(dbPath);
  try {
    const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if(tables.some(row=>row.name!=='cpu_qualification_runs'))throw new Error('Refusing a database containing non-trial tables.');
    database.pragma('journal_mode = DELETE');database.pragma('secure_delete = ON');
    database.exec('CREATE TABLE IF NOT EXISTS cpu_qualification_runs (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, identity_json TEXT NOT NULL, receipt_json TEXT NOT NULL)');
    database.prepare('INSERT INTO cpu_qualification_runs(created_at,identity_json,receipt_json) VALUES (?,?,?)')
      .run(new Date().toISOString(),JSON.stringify(marker.identity),JSON.stringify(receipt));
  } finally {database.close();}
  return dbPath;
}
export async function main(args=process.argv.slice(2)) {
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{
    'trial-root':{type:'string'},identity:{type:'string'},graph:{type:'string'},output:{type:'string'},
    receipt:{type:'string'},'expected-sha256':{type:'string'},profile:{type:'string'},logs:{type:'string'},
    samples:{type:'string'},help:{type:'boolean'}
  }});
  if(values.help||!positionals.length) {
    console.log([
      'CPU-only, source/offline qualification tools. This command never loads a model or runs inference.',
      'init --trial-root <NEW directory> --identity <complete identity JSON>',
      'inspect --trial-root <dir> --graph <graph.onnx> --output <new report.json>',
      'patch-nbits --trial-root <dir> --graph <source.onnx> --output <new derivative.onnx> --expected-sha256 <hash> --receipt <verified external-data.json>',
      'profile --trial-root <dir> --profile <ORT trace.json> [--logs <private ORT log>] --output <new report.json>',
      'quality --trial-root <dir> --samples <paired outputs and judgments.json> --output <new report.json>',
      'All non-init artifacts must be inside the dedicated trial root. Outputs never overwrite.',
      'patch-nbits receipt is {externalData:[{location,bytes,sha256}]}. Stage verified source graph/weights first.',
      'No downloads, live-index writes, automatic promotion, or native-work retry. See CPU qualification spec.'
    ].join('\n'));return;
  }
  const command=positionals[0],root=path.resolve(values['trial-root']??'');
  if(!values['trial-root'])throw new Error('Explicit dedicated trial root required.');
  if(command==='init') {
    const identity=validateTrialIdentity(JSON.parse(values.identity??'null'));
    await fs.mkdir(root);
    await fs.writeFile(path.join(root,'trial-manifest.json'),JSON.stringify({schema:SCHEMA,createdAt:new Date().toISOString(),identity},null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({ok:true,trialRoot:root,identity}));return;
  }
  const marker=JSON.parse(await readBounded(path.join(root,'trial-manifest.json'),1024*1024));
  if(marker.schema!==SCHEMA)throw new Error('Dedicated trial marker required.');
  validateTrialIdentity(marker.identity);
  const input=async flag=>{
    if(!values[flag])throw new Error('Missing --'+flag);
    return withinTrialRoot(path.resolve(values[flag]),root);
  };
  const output=await input('output');let receipt;
  if(command==='inspect') {
    const file=await input('graph'),bytes=await readBounded(file);
    receipt={...inspectOnnx(bytes).report,file,identity:marker.identity};
  }else if(command==='patch-nbits') {
    const verified=JSON.parse(await readBounded(await input('receipt'),1024*1024));
    receipt=await writeNbitsDerivative({source:await input('graph'),destination:output,trialRoot:root,
      expectedSha256:values['expected-sha256'],expectedExternalData:verified.externalData});
    await fs.writeFile(output+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  }else if(command==='profile') {
    const file=await input('profile'),bytes=await readBounded(file);
    const logs=values.logs?(await readBounded(await input('logs'))).toString('utf8'):'';
    receipt={...summarizeOrtProfile(JSON.parse(bytes),logs),profileSha256:await hashFile(file),identity:marker.identity};
  }else if(command==='quality') {
    const file=await input('samples'),bytes=await readBounded(file);
    const sample=JSON.parse(bytes);
    validateTrialIdentity(sample.reference?.identity);validateTrialIdentity(sample.candidate?.identity);
    if(JSON.stringify(sample.candidate.identity)!==JSON.stringify(marker.identity))throw new Error('Candidate identity must match trial manifest exactly.');
    receipt={...qualifyRetrieval(sample),samplesSha256:await hashFile(file),referenceIdentity:sample.reference.identity,candidateIdentity:sample.candidate.identity};
  }else throw new Error('Unknown qualification command.');
  if(command!=='patch-nbits')await fs.writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  const trialDatabase=await appendTrialReceipt(root,receipt);
  console.log(JSON.stringify({ok:true,command,output,trialDatabase}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
