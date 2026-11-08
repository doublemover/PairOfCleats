import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createArtifactBrowser } from '../../../src/map/workspace/catalog.js';
import { handleMapArtifactsRoute } from '../../../tools/api/router/map-artifacts.js';
import { getPendingSceneResourceOwners } from '../../../src/map/isometric/client/scene-retirement.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const directory=await fs.mkdtemp(path.join(os.tmpdir(),'poc-map-graph-scope-'));
applyTestEnv({cacheRoot:path.join(directory,'cache')});
const repo=path.join(directory,'repo'),retained=path.join(directory,'retained-build'),immutable=path.join(directory,'immutable','index-code');
await fs.mkdir(repo);await fs.mkdir(immutable,{recursive:true});
const capabilityId='d'.repeat(64),selection={indexRoot:retained,capabilityId};
const capability=Object.freeze({capability:'graph',status:'ready',capabilityId,buildId:'selected-failed-build',indexDir:immutable});
const scopes=[];
const withGraphCapability=async(root,options,consume)=>{
  assert.equal(root,repo);assert.equal(options.indexRoot,retained);
  if(options.capabilityId!==capabilityId)throw Object.assign(new Error('No matching graph capability'),{code:'ERR_GRAPH_CAPABILITY_UNAVAILABLE'});
  const scope={active:true,error:null};scopes.push(scope);let primary,failed=false;
  try{return await consume(capability);}catch(error){primary=error;failed=true;throw error;}
  finally{
    if(failed&&primary.cacheOwnershipReleased()!==true){
      const release=()=>{if(primary.cacheOwnershipReleased()!==true)throw new Error('original child remains pending');scope.active=false;return true;};
      const failure=new AggregateError([primary],'graph reader remains pending',{cause:primary});
      Object.defineProperties(failure,{releaseGraphReader:{value:release},cacheOwnershipPending:{get:()=>scope.active},cacheOwnershipReleased:{value:()=>!scope.active}});
      scope.error=failure;throw failure;
    }
    scope.active=false;
  }
};
const contains=(root,wanted,seen=new Set())=>{
  if(Object.is(root,wanted))return true;if(!root||typeof root!=='object'||seen.has(root))return false;seen.add(root);
  return contains(root.cause,wanted,seen)||(root.errors||[]).some(value=>contains(value,wanted,seen));
};
const outcome=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
let browser;
try{
  await fs.writeFile(path.join(immutable,'chunk_meta.json'),JSON.stringify(Array.from({length:300},(_,id)=>({id,start:id,end:id+1,name:`retained row ${id}`}))));
  await writePiecesManifest(immutable,[{name:'chunk_meta',path:'chunk_meta.json',format:'json'}]);
  browser=createArtifactBrowser({withGraphCapability});
  const catalog=await browser.catalog(repo,null,selection);
  assert.equal(scopes.at(-1).active,false);assert.equal(catalog.graphCapability.indexDir,immutable);assert.equal(catalog.graphCapability.buildId,'selected-failed-build');
  assert(catalog.warnings.some(value=>value.includes('does not establish')));
  const input={...selection,name:'chunk_meta',generation:catalog.generation};
  const first=await browser.read(repo,input),scope=scopes.at(-1),count=scopes.length;
  assert.equal(first.rows[0].name,'retained row 0');assert.equal(scope.active,true,'the original backend callback owns an idle continuation iterator');
  await assert.rejects(browser.read(repo,{...input,cursor:first.cursor,capabilityId:'e'.repeat(64)}),/scope mismatch/);
  assert.equal(scopes.length,count,'cursor mismatch cannot open a sibling backend reader');
  const second=await browser.read(repo,{...input,cursor:first.cursor});assert.equal(second.rows[0].id,128);assert.equal(scopes.length,count);
  const third=await browser.read(repo,{...input,cursor:second.cursor});assert.equal(third.rows.length,44);assert.equal(third.cursor,null);assert.equal(scope.active,false);
  await assert.rejects(browser.catalog(repo,null,{capabilityId}),/explicit retained/);
  await assert.rejects(browser.catalog(repo,null,{...selection,capabilityId:'e'.repeat(64)}),/No matching/);
  assert.equal(browser.cleanupFailed,false,'an ordinary invalid selector does not poison a usable browser');

  const req=new EventEmitter(),res=new EventEmitter();let response;
  res.writeHead=status=>{response={status};};res.end=body=>{response.body=JSON.parse(body);};
  await handleMapArtifactsRoute({req,res,requestUrl:new URL('http://localhost/map/catalog'),corsHeaders:{},parseJsonBody:async()=>({repoRoot:repo,...selection}),resolveRepo:()=>repo,browser});
  assert.equal(response.status,200);assert.equal(response.body.result.graphCapability.indexDir,immutable,'actual map API adapter forwards exact graph selectors');
  await browser.close();browser=null;

  let nativeDone=false,returnFails=true,returns=0;
  const primary=Object.freeze(new Error('original graph read failed'));
  const original=Object.freeze(Object.defineProperty(new Error('original iterator native close remains pending'),'sceneOwnershipReleased',{value:()=>nativeDone}));
  const iterator={ [Symbol.asyncIterator](){return this;},async next(){throw primary;},async return(){returns++;if(returnFails)throw original;return{done:true};} };
  browser=createArtifactBrowser({withGraphCapability,openRows:()=>iterator});
  const selected=await browser.catalog(repo,null,selection);
  const result=await outcome(browser.read(repo,{...selection,name:'chunk_meta',generation:selected.generation}));
  assert.equal(result.ok,false);assert(contains(result.error,primary));assert(contains(result.error,original));
  const held=scopes.at(-1);assert.equal(held.active,true);assert.equal(browser.cleanupFailed,true);assert(held.error);
  const owner=getPendingSceneResourceOwners().find(owner=>owner.resource===iterator);assert(owner);
  await assert.rejects(owner.releaseAsync());assert.equal(returns,1);nativeDone=true;
  assert.throws(()=>held.error.releaseGraphReader(),/original child/,'a true native marker alone cannot replace successful original iterator closure');
  returnFails=false;await owner.releaseAsync();assert.equal(returns,2);assert.equal(held.error.releaseGraphReader(),true);assert.equal(held.active,false);
  await assert.rejects(browser.catalog(repo,null,selection),/cleanup failed/);await assert.rejects(browser.close());browser=null;
}finally{await browser?.close().catch(()=>{});await fs.rm(directory,{recursive:true,force:true});}
console.log('Actual map artifact pages retain exact graph callback, iterator, cursor and cleanup authority.');
