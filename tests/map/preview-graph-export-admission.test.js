import assert from 'node:assert/strict';
import path from 'node:path';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { parseSavedMap } from '../../tools/analysis/map-saved-input.js';
import { captureMapPreviewGraphSelection, prepareMapPreviewExport } from '../../tools/analysis/map-preview-export.js';
const root=path.resolve('selected repo'),retained=path.resolve('retained exact build'),immutable=path.resolve('immutable snapshot'),out=path.resolve('preview 日本語.html');
const capabilityId='a'.repeat(64),manifest='b'.repeat(64);
const graph={capabilityId,buildId:'retained-build-id',sourceBuildRoot:retained,indexRoot:immutable,status:'ready',capability:'graph'};
const selectedIndex={mode:'code',indexDir:path.join(immutable,'index-code'),manifest,graphCapability:graph};
const fixture=()=>{
  const model={version:MAP_MODEL_VERSION,root:{path:root,id:'selected-repo'},options:{scope:'repo'},nodes:[],edges:[],
    provenance:{kind:'retained-graph-capability-export',selectedIndex}};
  const input=parseSavedMap(`<html><script type="application/json" id="map-data">${JSON.stringify(model)}</script></html>`);
  const receipt={ok:true,partial:false,requestedFormat:'html-iso',format:'html-iso',cacheKey:'original-cache-key',
    identity:{repo:model.root,selectedIndex:structuredClone(selectedIndex),producer:model.version,options:model.options},
    outputs:[{kind:'report',ok:true,path:out,sha256:input.sha256,bytes:input.bytes}]};
  const calls=[];
  return{input,receipt,calls,args:{argv:{'graph-capability':capabilityId,'index-root':retained,'no-open':true},toolRoot:process.cwd(),repoRoot:root,repoId:'selected-repo',runtimeEnv:{},outPath:out,
    spawnImpl:async(command,args,options)=>{calls.push({command,args,options});return{exitCode:0,stdout:JSON.stringify(receipt)};},
    readInput:async selected=>{assert.equal(selected,out);return input;}}};
};
{
  const f=fixture(),result=await prepareMapPreviewExport(f.args);
  assert.equal(result.identity.kind,'retained-graph-capability-export');assert.equal(result.identity.selectedIndex.indexDir,path.join(immutable,'index-code'));
  const args=f.calls[0].args;assert.equal(args[args.indexOf('--graph-capability')+1],capabilityId);assert.equal(args[args.indexOf('--index-root')+1],retained);
  assert.equal(args.includes('--serve'),false,'the child owns one real map read/render/publication, not another preview');
}
for(const mutate of [f=>{f.receipt.partial=true;},f=>{f.receipt.outputs[0].ok=false;},f=>{f.receipt.format='dot';},
  f=>{f.receipt.outputs[0].sha256='c'.repeat(64);},f=>{f.receipt.identity.selectedIndex.graphCapability.capabilityId='d'.repeat(64);},
  f=>{f.receipt.identity.selectedIndex.graphCapability.sourceBuildRoot=path.resolve('sibling build');},
  f=>{f.receipt.identity.selectedIndex.indexDir=path.join(retained,'index-code');},f=>{f.receipt.identity.selectedIndex.manifest='e'.repeat(64);},
  f=>{f.receipt.identity.repo={path:path.resolve('sibling repo'),id:'selected-repo'};},f=>{f.receipt.identity.options={scope:'other'};},
  f=>{f.input.model.provenance.selectedIndex.graphCapability.buildId='embedded sibling';}]){
  const f=fixture();mutate(f);await assert.rejects(prepareMapPreviewExport(f.args),{code:'ERR_MAP_PREVIEW_EXPORT_IDENTITY'});
}
for(const argv of [{'graph-capability':capabilityId},{'graph-capability':'bad','index-root':retained},
  {'graph-capability':capabilityId,'index-root':retained,input:'saved.html'},
  {'graph-capability':capabilityId,'index-root':retained,mode:'prose'}])assert.throws(()=>captureMapPreviewGraphSelection(argv),/requires an exact validated/);
for(const primary of [Object.freeze(new Error('actual output descriptor cleanup failed')),undefined,null,false]){
  const f=fixture();f.args.readInput=async()=>{throw primary;};
  const result=await prepareMapPreviewExport(f.args).then(()=>({ok:true}),error=>({ok:false,error}));
  assert.equal(result.ok,false);assert.equal(result.error,primary,'actual original saved-output admission failures are never replaced by a current graph');
}
console.log('Actual preview export preparation forwards exact graph authority and rejects publication/payload identity substitutions.');
