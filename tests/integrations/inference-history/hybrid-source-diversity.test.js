import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_ARCHIVE_ANALYZER, registerArchiveAnalyzer } from '../../../src/integrations/inference-history/lexical-analyzer.js';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { projectArtifact } from '../../../src/integrations/inference-history/artifact-projection.js';
import { createLocalSourceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { searchHybridHistory } from '../../../src/integrations/inference-history/hybrid.js';
import { historyIndexState } from '../../../src/integrations/inference-history/generation.js';
import { updateHistoryPrivacy } from '../../../src/integrations/inference-history/privacy.js';
import { visibleNode } from '../../../src/integrations/inference-history/reader.js';
import { readHistoryCandidates } from '../../../src/integrations/inference-history/reader.js';
const base=path.resolve('temp/tasks/archive-retrieval-tests');await fs.mkdir(base,{recursive:true});
const root=await fs.mkdtemp(path.join(base,'diversity-'));
const source=path.join(root,'artifacts-0001.json'),indexPath=path.join(root,'archive.sqlite');
const records=[
  ...projectArtifact({text:'cobalt code '+ 'padding '.repeat(90),sourceSha256:'a'.repeat(64),locator:'widget.swift',kind:'code',chunkChars:256}),
  ...projectArtifact({text:'cobalt activity update',sourceSha256:'a'.repeat(64),locator:'widget.swift/activity',kind:'activity'}),
  ...projectArtifact({text:'cobalt unrelated document',sourceSha256:'b'.repeat(64),locator:'other.md'}),
  ...projectArtifact({text:'body contains no title keyword',sourceSha256:'c'.repeat(64),locator:'NebulaHTTPServer.swift'}),
  ...projectArtifact({text:'cobalt forbidden',sourceSha256:'d'.repeat(64),locator:'excluded.swift'}),
];
await fs.writeFile(source,JSON.stringify(records));
const service=await createLocalSourceHistoryService({sources:[{path:source,sha256:digest(await fs.readFile(source))}],indexPath});
await service.dispose();
const db=new Database(indexPath);registerArchiveAnalyzer(db,DEFAULT_ARCHIVE_ANALYZER);const generation=historyIndexState(db).generationRef;
const rows=db.prepare('SELECT u.id sourceRef,su.snapshot_id snapshotRef,u.text FROM units u JOIN snapshot_units su ON su.unit_id=u.id ORDER BY u.id').all();
let calls=0;const semantic={kind:'local',indexGenerationRef:generation,modelId:'no-model-fixture',modelVersion:'1',dimensions:2,
  search:async()=>{calls++;return {candidates:rows.map(({sourceRef,snapshotRef})=>({sourceRef,snapshotRef})),complete:true};}};
const request={query:'cobalt',mode:'hybrid',maxPerOriginal:1,top:20};
const result=await searchHybridHistory(db,request,semantic,async()=>{});
assert.equal(result.hits.filter(row=>row.originalHash==='a'.repeat(64)).length,1);
assert.ok(result.hits.some(row=>row.originalHash==='b'.repeat(64)));
for(const hit of result.hits)assert.ok(rows.some(row=>row.sourceRef===hit.sourceRef&&row.snapshotRef===hit.snapshotRef));
assert.equal(result.semantic.rerankerAvailable,false);
for(const bad of [{maxPerOriginal:0},{maxPerConversation:101},{groupBy:'fragment'}])await assert.rejects(searchHybridHistory(db,{...request,...bad},semantic,async()=>{}),{code:'ERR_INFERENCE_HISTORY_INPUT'});
const before=calls;await assert.rejects(searchHybridHistory(db,{...request,rerank:true},semantic,async()=>{}),{code:'ERR_INFERENCE_HISTORY_UNAVAILABLE'});assert.equal(calls,before);
const metadata=await searchHybridHistory(db,{query:'NebulaHTTPServer',mode:'hybrid'}, {...semantic,search:async()=>({candidates:[],complete:true})},async()=>{});
assert.equal(metadata.hits.length,1);assert.equal(metadata.hits[0].originalHash,'c'.repeat(64));
assert.equal(metadata.hits[0].text,'body contains no title keyword');assert.ok(metadata.channels.metadata.authorizedGroups>0);
const excluded=await searchHybridHistory(db,{query:'cobalt -forbidden',mode:'hybrid'},semantic,async()=>{});
assert.ok(excluded.hits.every(row=>!row.text.includes('forbidden')));
const phrase=await searchHybridHistory(db,{query:'"cobalt unrelated"',mode:'hybrid'},semantic,async()=>{});
assert.equal(phrase.hits.length,1);assert.equal(phrase.hits[0].originalHash,'b'.repeat(64));
assert.equal((await searchHybridHistory(db,{query:'cobalt',mode:'hybrid',role:'user'},semantic,async()=>{})).hits.length,0);
assert.equal((await searchHybridHistory(db,{query:'cobalt',mode:'semantic',dateFrom:'2026-10-09'},semantic,async()=>{})).hits.length,0);
const wrong=rows.map(row=>({...row,snapshotRef:'f'.repeat(64)}));assert.equal(readHistoryCandidates(db,{query:'cobalt'},wrong).hits.length,0);
const grouped=await searchHybridHistory(db,{query:'cobalt',mode:'hybrid',groupBy:'original'},semantic,async()=>{});
assert.equal(new Set(grouped.hits.map(row=>row.originalHash)).size,grouped.hits.length);
assert.equal((await searchHybridHistory(db,{query:'cobalt',mode:'hybrid',pathState:'on_selected_path'},semantic,async()=>{})).hits.length,0);
await assert.rejects(searchHybridHistory(db,{query:'cobalt',mode:'hybrid',searchField:'metadata'},semantic,async()=>{}),{code:'ERR_INFERENCE_HISTORY_INPUT'});
const metadataOnly=await searchHybridHistory(db,{query:'NebulaHTTPServer',mode:'auto',searchField:'title'},semantic,async()=>{});
assert.equal(metadataOnly.query.retrievalMode,'lexical');assert.equal(metadataOnly.hits.length,1);
const privateRecord=db.prepare("SELECT record_id FROM units WHERE text LIKE '%cobalt unrelated%'").get().record_id;
updateHistoryPrivacy(db,{recordRef:privateRecord,excluded:false,redactions:['unrelated'],annotation:''},visibleNode);
const privateRead=readHistoryCandidates(db,{query:'cobalt'},rows);
assert.ok(privateRead.hits.some(row=>row.text.includes('[REDACTED owner]')));
assert.ok(privateRead.hits.every(row=>!row.text.includes('unrelated')));
updateHistoryPrivacy(db,{recordRef:privateRecord,excluded:true,redactions:['unrelated'],annotation:''},visibleNode);
assert.ok(readHistoryCandidates(db,{query:'cobalt'},rows).hits.every(row=>row.recordRef!==privateRecord));
db.close();console.log('No-model archive original diversity, metadata hybrid, exact citations, role/date/exclusion/phrase guards and unavailable reranker passed');
