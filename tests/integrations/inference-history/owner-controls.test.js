import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createInferenceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { createHistoryAuditLedger } from '../../../src/integrations/inference-history/audit.js';
import { createHistoryOwnerConsole, renderHistoryOwnerInventory } from '../../../src/integrations/inference-history/owner-console.js';
import { createLocalHistorySemanticAdapter } from '../../../src/integrations/inference-history/semantic-adapter.js';
import { privacyText } from '../../../src/integrations/inference-history/privacy.js';
import { runHistoryCallback } from '../../../src/integrations/inference-history/bounded-callback.js';

// Synthetic private roots only. Retained for inspection; never open owner archives or old audit logs.
const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'poc-owner-controls-')));
const vaultRoot=path.join(root,'vault'),auditRoot=path.join(root,'audit'),source=path.join(root,'synthetic.json');
await fs.mkdir(vaultRoot,{mode:0o700});await fs.mkdir(auditRoot,{mode:0o700});
let epoch='1',human=true;
const access={principalId:'alice',tenantId:'fixture',ownerType:'individual',ownerId:'alice',sourceScope:'synthetic',allowed:true};
const request={requestContext:'human-session',partition:'fixture'};
const resolveAccess=({requestContext,partition})=>['human-session','agent-session'].includes(requestContext)&&partition==='fixture'?{...access,policyEpoch:epoch}:null;
const resolveOwnerAccess=({requestContext})=>human&&requestContext==='human-session'?{...access,channel:'human',policyEpoch:epoch}:null;
const ledger=createHistoryAuditLedger({auditRoot,verifyPrivateVault:()=>true});
const options={vaultRoot,verifyPrivateVault:()=>true,resolveAccess,resolveOwnerAccess,audit:ledger.append,
  resolveImportSource:()=>({path:source,policyEpoch:'1'})};
assert.throws(()=>createInferenceHistoryService({...options,audit:null}),{code:'ERR_INFERENCE_HISTORY_AUDIT'});
const service=createInferenceHistoryService(options);
const console=createHistoryOwnerConsole({service,auditLedger:ledger,
  authenticateHuman:context=>context==='human-session'?{channel:'human',principalId:'alice'}:null});
const node=(id,text)=>({id,parent:null,children:[],message:{id,author:{role:'user'},create_time:1800000000,
  content:{content_type:'text',parts:[text]}}});
const raw={id:'fixture-record',title:'SecretParcel planning',current_node:'a',mapping:{a:node('a','Keep SecretParcel plans with cobalt.')}};
await fs.writeFile(source,JSON.stringify([raw]));
await service.importExport(request);
const hit=(await service.search({...request,query:'SecretParcel'})).hits[0];
assert.ok(hit);
await assert.rejects(console.inventory({...request,requestContext:'agent-session'}),{code:'ERR_INFERENCE_HISTORY_DENIED'});
await assert.rejects(service.ownerInventory({...request,requestContext:'agent-session',ownerIdentity:{channel:'human',principalId:'alice'}}),{code:'ERR_INFERENCE_HISTORY_DENIED'});
await assert.rejects(createInferenceHistoryService({...options,resolveOwnerAccess:null}).ownerInventory(request),{code:'ERR_INFERENCE_HISTORY_DENIED'});
let inventory=await console.inventory(request);
assert.equal(inventory.records[0].recordRef,hit.recordRef);
assert.match(renderHistoryOwnerInventory(inventory),/visible/);
const policy={...request,recordRef:hit.recordRef,excluded:false,redactions:['SecretParcel'],annotation:'Owner note, not instructions.'};
const changed=await console.setPrivacy(policy);
assert.equal(changed.changed,true);
assert.notEqual(changed.index.generationRef,inventory.index.generationRef);
assert.equal((await console.setPrivacy(policy)).changed,false);
assert.equal((await service.search({...request,query:'SecretParcel'})).hits.length,0);
const sanitized=(await service.search({...request,query:'cobalt'})).hits[0];
assert.ok(sanitized.text.includes('[REDACTED owner]'));
assert.ok(!JSON.stringify(sanitized).includes('SecretParcel'));
const context=await service.readContext({...request,sourceRef:hit.sourceRef,snapshotRef:hit.snapshotRef});
assert.ok(!JSON.stringify(context).includes('SecretParcel'));
const references=await service.readReferences({...request,sourceRef:hit.sourceRef});
assert.ok(!JSON.stringify(references).includes('SecretParcel'));
await assert.rejects(service.readOriginal({...request,snapshotRef:hit.snapshotRef}),{code:'ERR_INFERENCE_HISTORY_DENIED'});
await assert.rejects(service.search({...request,query:'cobalt',expectedGeneration:inventory.index.generationRef}),{code:'ERR_INFERENCE_HISTORY_STALE'});
assert.equal(privacyText('price $5, [private], 😀',{redactions:['$5','[private]','😀']}),'price [REDACTED owner], [REDACTED owner], [REDACTED owner]');
const state=sanitized;
const current=(await service.search({...request,query:'cobalt'})).index;
const adapter=createLocalHistorySemanticAdapter({modelId:'synthetic',modelVersion:'toy1',dimensions:1,indexGenerationRef:current.generationRef,
  encodeQuery:()=>[1],searchIndex:()=>({candidates:[{sourceRef:state.sourceRef,snapshotRef:state.snapshotRef,text:'SecretParcel'}],complete:true})});
const hybrid=createInferenceHistoryService({...options,semantic:adapter});
for(const invalidPage of [{top:0},{top:101},{top:'10'},{offset:-1},{offset:'0'},{offset:100001},{rerank:'true'}]){
  await assert.rejects(hybrid.search({...request,query:'planning',mode:'hybrid',...invalidPage}),{code:'ERR_INFERENCE_HISTORY_INPUT'});
}
assert.ok(!JSON.stringify((await hybrid.search({...request,query:'planning',mode:'semantic'})).hits).includes('SecretParcel'));
const spanAdapter=createLocalHistorySemanticAdapter({modelId:'synthetic',modelVersion:'toy1',dimensions:1,indexGenerationRef:current.generationRef,
  encodeQuery:()=>[1],searchIndex:()=>({candidates:[{sourceRef:state.sourceRef,snapshotRef:state.snapshotRef,span:{start:5,end:21}}],complete:true})});
const spanResult=await createInferenceHistoryService({...options,semantic:spanAdapter}).search({...request,query:'planning',mode:'semantic'});
assert.equal(spanResult.hits[0].snippet.start,5);
assert.equal(spanResult.totalMatchedUnits,null);assert.equal(spanResult.candidateMatches,null);
assert.equal(spanResult.channels.lexical.totalMatchedUnits,0);
assert.equal(spanResult.channels.semantic.authorizedGroups,1);
assert.equal(spanResult.hits[0].text,sanitized.text.slice(5,21));
const invalidSpan=createLocalHistorySemanticAdapter({modelId:'synthetic',modelVersion:'toy1',dimensions:1,indexGenerationRef:current.generationRef,
  encodeQuery:()=>[1],searchIndex:()=>({candidates:[{sourceRef:state.sourceRef,snapshotRef:state.snapshotRef,span:{start:0,end:99999}}],complete:true})});
await assert.rejects(createInferenceHistoryService({...options,semantic:invalidSpan}).search({...request,query:'planning',mode:'semantic'}),{code:'ERR_INFERENCE_HISTORY_INPUT'});
// A policy epoch change during a trusted semantic callback prevents evidence release.
const revoked=createLocalHistorySemanticAdapter({modelId:'synthetic',modelVersion:'toy1',dimensions:1,indexGenerationRef:current.generationRef,
  encodeQuery:()=>[1],searchIndex:()=>{epoch='2';return {candidates:[state],complete:true};}});
await assert.rejects(createInferenceHistoryService({...options,semantic:revoked}).search({...request,query:'planning',mode:'semantic'}),{code:'ERR_INFERENCE_HISTORY_DENIED'});
epoch='1';
await console.setPrivacy({...policy,excluded:true});
assert.equal((await service.search({...request,query:'cobalt'})).hits.length,0);
assert.equal((await service.search({...request,query:'cobalt'})).coverage.records,0);
assert.equal(await service.readContext({...request,sourceRef:hit.sourceRef,snapshotRef:hit.snapshotRef}),null);
assert.equal(await service.readOriginal({...request,snapshotRef:hit.snapshotRef}),null);
raw.mapping.b=node('b','Another SecretParcel cobalt sentence.');
await fs.writeFile(source,JSON.stringify([raw]));
await service.importExport(request);
assert.equal((await service.search({...request,query:'cobalt',includeHistory:true})).hits.length,0);
await console.setPrivacy({...policy,excluded:false});
assert.equal((await service.search({...request,query:'SecretParcel',includeHistory:true})).hits.length,0);
assert.ok((await service.search({...request,query:'cobalt'})).hits.length);
// Audit failures never release data, including a sink that claims success without acknowledgement.
await assert.rejects(createInferenceHistoryService({...options,audit:()=>undefined}).search({...request,query:'cobalt'}),{code:'ERR_INFERENCE_HISTORY_AUDIT'});
await assert.rejects(createInferenceHistoryService({...options,audit:()=>{throw new Error('private sink detail');}}).search({...request,query:'cobalt'}),{code:'ERR_INFERENCE_HISTORY_AUDIT'});
const logs=await console.audit({...request,top:100});
assert.ok(logs.events.some(event=>event.query==='SecretParcel'));
assert.ok(logs.events.every(event=>event.tenantId==='fixture'&&event.ownerId==='alice'));
assert.ok(logs.events.every(event=>event.instructionAuthority==='none'));
assert.ok(!JSON.stringify(logs.events).includes(raw.mapping.a.message.content.parts[0]));
await ledger.append({...access,policyEpoch:'1',action:'search',query:'foreign-query',ownerId:'bob',outcome:'allowed'});
assert.ok(!(await console.audit({...request,top:100})).events.some(event=>event.query==='foreign-query'));
human=false;
await assert.rejects(console.audit(request),{code:'ERR_INFERENCE_HISTORY_DENIED'});
human=true;
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),10);
const abort=controller.signal;
await assert.rejects(runHistoryCallback(()=>new Promise(()=>{}),abort),{code:'ERR_INFERENCE_HISTORY_LIMIT'});
clearTimeout(timer);
await service.deleteRecord({...request,recordRef:hit.recordRef});
const tombstone=(await console.inventory(request)).records.find(row=>row.recordRef===hit.recordRef);
assert.equal(tombstone.deleted,true);assert.equal(tombstone.redactionCount,0);assert.equal(tombstone.annotation,'');
// A v4 synthetic store is refused before any rewrite. The original source remains untouched.
const database=path.join(vaultRoot,(await fs.readdir(vaultRoot)).find(name=>name.endsWith('.sqlite')));
const db=new Database(database);
db.prepare("UPDATE vault_meta SET value='inference-history.v4' WHERE key='format'").run();db.close();
const before=await fs.readFile(database);
await assert.rejects(service.search({...request,query:'cobalt'}),{code:'ERR_INFERENCE_HISTORY_STORAGE'});
assert.deepEqual(await fs.readFile(database),before);
process.stdout.write('Synthetic owner audit/privacy, semantic revocation and v4 refusal checks passed.\n');
