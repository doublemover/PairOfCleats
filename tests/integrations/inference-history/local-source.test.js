import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir } from '../../helpers/temp.js';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { createInferenceHistoryService, createLocalSourceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { createHistoryAgentBroker } from '../../../src/integrations/inference-history/agent-broker.js';
import { createHistoryOwnerConsole } from '../../../src/integrations/inference-history/owner-console.js';
import { createHistoryAgentReader } from '../../../src/integrations/inference-history/agent-reader.js';
import { createHistoryAuditLedger } from '../../../src/integrations/inference-history/audit.js';
import { createHistoryOwnerHttpHandler } from '../../../src/integrations/inference-history/owner-http.js';

const root=await fs.realpath(await makeTempDir('local-source-history-'));
const source=path.join(root,'artifacts-0001.json');
await fs.writeFile(source,JSON.stringify(projectArtifact({text:'synthetic cobalt artifact',sourceSha256:'a'.repeat(64),locator:'fixture.txt'})));
const bytes=await fs.readFile(source),before=await fs.readdir(root),sourceMode=(await fs.stat(source)).mode;
const options={sources:[{path:source,sha256:digest(bytes)}]};
await assert.rejects(createLocalSourceHistoryService({...options,maxSourceBytes:1}),{code:'ERR_INFERENCE_HISTORY_LIMIT'});
await assert.rejects(createLocalSourceHistoryService({...options,sources:[{path:source,sha256:'b'.repeat(64)}]}),{code:'ERR_INFERENCE_HISTORY_INPUT'});
await assert.rejects(createLocalSourceHistoryService({sources:[{path:'../escape.json',sha256:digest(bytes)}]}),{code:'ERR_INFERENCE_HISTORY_INPUT'});
await assert.rejects(createLocalSourceHistoryService({...options,resolveAccess:()=>true}),{code:'ERR_INFERENCE_HISTORY_INPUT'});
const local=await createLocalSourceHistoryService(options);
const result=await local.search({query:'cobalt',role:'artifact'});
assert.equal(result.totalMatches,1);
assert.equal(result.localSource.audit,'disabled');
assert.equal(result.localSource.filesystemIndexWrites,false);
assert.equal(result.localSource.storage,'memory_only');
for(const action of ['importExport','deleteRecord','ownerSetPrivacy','ownerInventory'])assert.equal(local[action],undefined);
assert.throws(()=>createHistoryAgentBroker({service:local,boundary:{bind(){}}}),/authenticated/);
assert.throws(()=>createHistoryAgentBroker({service:{...local},boundary:{bind(){}}}),/authenticated/);
assert.throws(()=>createHistoryOwnerConsole({service:local,authenticateHuman:()=>{},auditLedger:{}}),/owner host/);
const reader=createHistoryAgentReader({service:local});
const packet=await reader.execute('search',{query:'cobalt'});
assert.equal(packet.ok,true);assert.equal(packet.page.totalMatches,1);
await local.dispose();await assert.rejects(local.search({query:'cobalt'}),{code:'ERR_INFERENCE_HISTORY_DENIED'});
assert.deepEqual(await fs.readdir(root),before);
assert.deepEqual(await fs.readFile(source),bytes);
assert.equal((await fs.stat(source)).mode,sourceMode);
for(const audit of [()=>({persisted:false}),()=>{throw Error('optional log unavailable');}]){
  const logged=await createLocalSourceHistoryService({...options,audit});
  assert.equal((await logged.search({query:'cobalt'})).totalMatches,1);
  assert.equal(logged.localSource.audit,'optional_callback');await logged.dispose();
}
console.log('selected local reads without host/audit/ACL prerequisites, optional log failures, source preservation and transport guards passed');

const access={principalId:'fixture',tenantId:'fixture',ownerType:'individual',ownerId:'fixture',sourceScope:'synthetic',policyEpoch:'1',allowed:true};
assert.throws(()=>createInferenceHistoryService({resolveAccess:()=>access}),{code:'ERR_INFERENCE_HISTORY_AUDIT'});
assert.throws(()=>createInferenceHistoryService({resolveAccess:()=>access,audit:()=>({persisted:true}),localSourceToken:'local'}),{code:'ERR_INFERENCE_HISTORY_DENIED'});
assert.throws(()=>createHistoryAgentReader({service:{search(){}}}),/partition/);
const broadVault=path.join(root,'synthetic-broad-vault');await fs.mkdir(broadVault,{mode:0o755});
const strict=createInferenceHistoryService({vaultRoot:broadVault,resolveAccess:()=>access,audit:()=>({persisted:true}),verifyPrivateVault:()=>false});
await assert.rejects(strict.search({requestContext:'fixture',partition:'own',query:'cobalt'}),{code:'ERR_INFERENCE_HISTORY_STORAGE'});
const ledger=createHistoryAuditLedger({auditRoot:broadVault,verifyPrivateVault:()=>false});
await assert.rejects(ledger.append({action:'synthetic'}),{code:'ERR_INFERENCE_HISTORY_STORAGE'});
assert.deepEqual(await fs.readdir(broadVault),[]);
assert.throws(()=>createHistoryOwnerHttpHandler({console:{executionContext:'local_source_readonly',page(){},audit(){},setPrivacy(){}},boundary:{bind(){}},origin:'https://fixture.invalid'}),/trusted owner/);
await assert.rejects(createLocalSourceHistoryService({...options,maxUnits:0}),{code:'ERR_INFERENCE_HISTORY_INPUT'});
const manyPath=path.join(root,'artifacts-0002.json'),manyBytes=Buffer.from(JSON.stringify(projectArtifact({text:'bounded artifact '.repeat(1000),sourceSha256:'c'.repeat(64),locator:'many.txt'})));
await fs.writeFile(manyPath,manyBytes);
await assert.rejects(createLocalSourceHistoryService({...options,sources:[{path:manyPath,sha256:digest(manyBytes)}],maxUnits:1}),{code:'ERR_INFERENCE_HISTORY_LIMIT'});
console.log('service audit/storage/authentication guards and local corpus limits remain enforced');

const {default:Database}=await import('better-sqlite3');
const originalName='file_'+ '1'.repeat(32)+'.dat',originalPath=path.join(root,originalName);
const originalBytes=Buffer.from('cobalt opening '+ 'middle document '.repeat(600)+'closing quartz');
const originalSha=digest(originalBytes);await fs.writeFile(originalPath,originalBytes);
const widgetBytes=Buffer.from(JSON.stringify({backing_conversation_id:'fixture-conversation',widget_session_id:'widget-fixture'}));
const widgetSha=digest(widgetBytes);await fs.writeFile(path.join(root,'widget.dat'),widgetBytes);
const catalogPath=path.join(root,'evidence.sqlite'),catalog=new Database(catalogPath);
catalog.exec('CREATE TABLE meta(key TEXT,value TEXT);CREATE TABLE sources(id INTEGER,parent_id INTEGER,name TEXT,sha256 TEXT,format TEXT);CREATE TABLE blobs(sha256 TEXT,data BLOB);CREATE TABLE documents(sha256 TEXT,format TEXT,text TEXT);CREATE TABLE attachment_links(source_id INTEGER,document_sha256 TEXT,json_path TEXT)');
catalog.prepare('INSERT INTO meta VALUES (?,?)').run('format','private-file-evidence.v1');
catalog.prepare('INSERT INTO sources VALUES (?,?,?,?,?)').run(1,null,originalName,originalSha,'text');
catalog.prepare('INSERT INTO sources VALUES (?,?,?,?,?)').run(2,null,'widget.dat',widgetSha,'json');
catalog.prepare('INSERT INTO documents VALUES (?,?,?)').run(widgetSha,'json',widgetBytes.toString());
catalog.prepare('INSERT INTO attachment_links VALUES (?,?,?)').run(1,widgetSha,'/file');
const embeddedBytes=Buffer.from('embedded archive fixture'),embeddedSha=digest(embeddedBytes);
catalog.prepare('INSERT INTO sources VALUES (?,?,?,?,?)').run(3,1,'member.txt',embeddedSha,'text');
catalog.prepare('INSERT INTO blobs VALUES (?,?)').run(embeddedSha,embeddedBytes);catalog.close();
const mixedArtifactPath=path.join(root,'artifacts-0003.json');
await fs.writeFile(mixedArtifactPath,JSON.stringify([
  ...projectArtifact({text:originalBytes.toString(),sourceSha256:originalSha,locator:originalName}),
  ...projectArtifact({text:'widget backing fixture',sourceSha256:widgetSha,locator:'widget.dat'}),
  ...projectArtifact({text:embeddedBytes.toString(),sourceSha256:embeddedSha,locator:'member.txt'})]));
const conversationsPath=path.join(root,'conversations.json');
await fs.writeFile(conversationsPath,JSON.stringify([{id:'fixture-conversation',title:'attached fixture',current_node:'n',mapping:{
  n:{id:'n',parent:null,message:{id:'m',author:{role:'user'},create_time:1,
    content:{content_type:'text',parts:['conversation attachment fixture']},metadata:{attachments:[{id:originalName.slice(0,-4)}]}}}}}]));
const collectionOptions={sources:await Promise.all([mixedArtifactPath,conversationsPath].map(async p=>({path:p,sha256:digest(await fs.readFile(p))}))),
  indexPath:path.join(root,'collection.sqlite'),catalogs:[{path:catalogPath,sourceRoot:root}]};
const collection=await createLocalSourceHistoryService(collectionOptions);
const artifactHit=(await collection.search({query:'cobalt'})).hits[0];
const context=await collection.readContext({...artifactHit,before:1,after:2,top:3});
assert.equal(context.scope,'adjacent_artifact_chunks');assert.equal(context.messages.length,3);
assert.ok(context.messages.every(m=>m.snapshotRef&&m.provenance));
const originalResult=await collection.readOriginal({snapshotRef:artifactHit.snapshotRef});
assert.equal(originalResult.preservedOriginal.state,'verified_original');
assert.equal(originalResult.preservedOriginal.sourceSha256,originalSha);
assert.equal(originalResult.preservedOriginal.bytes,originalBytes.length);
const widgetHit=(await collection.search({query:'widget backing'})).hits[0];
const widgetResult=await collection.readOriginal({snapshotRef:widgetHit.snapshotRef});
assert.ok(widgetResult.archiveRelations.some(r=>r.relation==='declared_backing_conversation'&&r.state==='indexed'));
assert.ok(widgetResult.archiveRelations.some(r=>r.relation==='exact_file_reference'&&r.state==='indexed'));
const conversationHit=(await collection.search({query:'conversation attachment'})).hits[0];
const conversationContext=await collection.readContext({...conversationHit});
assert.ok(conversationContext.archiveRelations.some(r=>r.relation==='declared_message_attachment'&&r.state==='indexed'));
const memberHit=(await collection.search({query:'embedded archive'})).hits[0];
const memberOriginal=await collection.readOriginal({snapshotRef:memberHit.snapshotRef});
assert.equal(memberOriginal.preservedOriginal.lineage.length,2);
assert.equal(Buffer.from(memberOriginal.preservedOriginal.base64,'base64').toString(),embeddedBytes.toString());
await collection.dispose();
const reloaded=await createLocalSourceHistoryService(collectionOptions);
const reloadedHit=(await reloaded.search({query:'cobalt'})).hits[0];
assert.equal(reloadedHit.sourceRef,artifactHit.sourceRef);assert.equal(reloadedHit.snapshotRef,artifactHit.snapshotRef);
assert.equal((await reloaded.readOriginal({snapshotRef:artifactHit.snapshotRef})).preservedOriginal.state,'verified_original');
await reloaded.dispose();
assert.deepEqual(await fs.readFile(originalPath),originalBytes);
console.log('mixed archive references, adjacent chunks, preserved member originals and reload-stable citations passed');
