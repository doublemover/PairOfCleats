import { ARCHIVE_CLASSIFICATION_VERSION, classifyArchiveSource } from './archive-structure.js';
import { normalizeHistoryRecord } from './records.js';
import { DEFAULT_LIMITS } from './common.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ARTIFACT_PROJECTION_VERSION, projectArtifact, sanitizeArtifactJson } from './artifact-projection.js';
export async function prepareFileEvidenceArtifacts({catalogPaths,outputRoot,authorizePaths,maxTextBytes=32*1024*1024,maxRecords=100000}) {
  if(typeof authorizePaths!=='function'||await authorizePaths({catalogPaths,outputRoot})!==true
  ||!Array.isArray(catalogPaths)||!catalogPaths.length||!Number.isSafeInteger(maxTextBytes)||maxTextBytes<1
  ||maxTextBytes>64*1024*1024||!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>1000000)throw new Error('Explicit artifact preparation authorization required.');
  outputRoot=path.resolve(outputRoot);await fs.mkdir(outputRoot);
  const summary={version:ARTIFACT_PROJECTION_VERSION,classificationVersion:ARCHIVE_CLASSIFICATION_VERSION,lexicalOnlyProposals:0,assetOmissions:{},activation:'not_imported',records:0,unsafeRecordsOmitted:0,documents:0,visibleActivity:0,toolMetadata:0,hiddenActivityOmitted:0,traceDocumentsOmitted:0,oversizeDocuments:0,recordLimitOmissions:0,firstTimestamp:null,lastTimestamp:null,projectMentions:{PairOfCleats:0,SagnacAndSons:0,NuSSR:0},shards:[]};
  let batch=[],ordinal=0;
  const flush=async()=>{if(!batch.length)return;const name='artifacts-'+String(++ordinal).padStart(4,'0')+'.json';await fs.writeFile(path.join(outputRoot,name),JSON.stringify(batch)+'\n',{flag:'wx'});summary.shards.push({name,records:batch.length});batch=[];};
  const emit=async(text,row,kind='document',createdAt=null,dateBasis='unknown',suffix='',originalTextChars=text.length,sourceTransformed=false)=>{
    const records=projectArtifact({text,sourceSha256:row.sha256,locator:row.locator+suffix,kind,createdAt,dateBasis,audit:summary.assetOmissions,originalTextChars,sourceTransformed});
    if(!classifyArchiveSource({locator:row.locator+suffix,kind,text}).proposedSemanticEligibility)summary.lexicalOnlyProposals++;
    if(!records.length&&text)summary.traceDocumentsOmitted++;
    if(summary.records+records.length>maxRecords){summary.recordLimitOmissions++;return;}
    for(const record of records){try{normalizeHistoryRecord(record,'recovered_artifact',DEFAULT_LIMITS);}catch{summary.unsafeRecordsOmitted++;continue;}batch.push(record);summary.records++;if(batch.length>=1000)await flush();}
    for(const [name,pattern] of [['PairOfCleats',/PairOfCleats|doublecleat/i],['SagnacAndSons',/SagnacAndSons|sagnac/i],['NuSSR',/NuSSR|SuperSlopRoad/i]])if(pattern.test(text))summary.projectMentions[name]++;
    if(createdAt){summary.firstTimestamp=summary.firstTimestamp===null||createdAt<summary.firstTimestamp?createdAt:summary.firstTimestamp;summary.lastTimestamp=summary.lastTimestamp===null||createdAt>summary.lastTimestamp?createdAt:summary.lastTimestamp;}
  };
  for(const catalogPath of catalogPaths){
    if(await fs.realpath(catalogPath)!==path.resolve(catalogPath))throw new Error('Canonical catalog required.');
    const db=new Database(catalogPath,{readonly:true});
    try{
      if(db.prepare("SELECT value FROM meta WHERE key='format'").get()?.value!=='private-file-evidence.v1')throw new Error('File evidence required.');
      const queries=["SELECT sha256,format,text FROM documents WHERE status IN ('supported','facts_limited')",
        ...(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='derived_documents'").get()?["SELECT source_sha256 AS sha256,kind AS format,text FROM derived_documents WHERE status='supported'"]:[]),
        ...(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='format_recovery'").get()?["SELECT sha256,format,text FROM format_recovery WHERE text IS NOT NULL"]:[])];
      for(const query of queries)for(const item of db.prepare(query).iterate()){
        if(!item.text)continue;
        if(Buffer.byteLength(item.text)>maxTextBytes){summary.oversizeDocuments++;continue;}
        const source=db.prepare('SELECT name,id FROM sources WHERE sha256=? ORDER BY id LIMIT 1').get(item.sha256);
        const row={...item,locator:path.basename(path.dirname(catalogPath))+'/'+source.id+'/'+source.name};
        let text=item.text;
        if(item.format==='json'||item.format==='jsonl'){
          let raw;try{raw=JSON.parse(text);}catch{summary.traceDocumentsOmitted++;continue;}
          const stack=[raw];let inspected=0;
          while(stack.length&&inspected++<1000000){
            const value=stack.pop();if(!value||typeof value!=='object')continue;
            if(Array.isArray(value.activity_messages))for(const [index,item] of value.activity_messages.entries()){
              const message=item?.message??item,role=message?.author?.role??message?.role;
              if(!message||message.channel==='analysis'||message.metadata?.is_visually_hidden_from_conversation||!['assistant','user','tool'].includes(role)){summary.hiddenActivityOmitted++;continue;}
              const stamp=message.create_time??message.timestamp,ms=typeof stamp==='number'?stamp*1000:Date.parse(stamp);
              const date=Number.isFinite(ms)&&Math.abs(ms)<=8640000000000000?new Date(ms).toISOString():null;
              if(role==='tool'){
                await emit('Tool activity metadata: '+JSON.stringify({role:'tool',channel:['final','commentary'].includes(message.channel)?message.channel:'unspecified',timestamp:date}),row,'tool_activity',date,date?'declared_message_timestamp':'unknown','/activity/'+index);
                summary.toolMetadata++;continue;
              }
              if(message.recipient&&message.recipient!=='all'||role==='assistant'&&message.channel!=='final'&&message.channel!=='commentary'){summary.hiddenActivityOmitted++;continue;}
              const content=message.content,parts=Array.isArray(content?.parts)?content.parts:[];
              if(!['text',undefined].includes(content?.content_type)){summary.hiddenActivityOmitted++;continue;}
              const body=parts.filter(part=>typeof part==='string').join('\n');
              if(body){await emit(body,row,'activity',date,date?'declared_message_timestamp':'unknown','/activity/'+index);summary.visibleActivity++;}
            }
            for(const [key,child] of Object.entries(value))if(key!=='activity_messages'&&child&&typeof child==='object')stack.push(child);
          }
          text=JSON.stringify(sanitizeArtifactJson(raw,0,{audit:summary.assetOmissions}),null,2);
        }else if(item.format==='html')text=text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]+>/g,' ');
        await emit(text,row,['code','config'].includes(classifyArchiveSource({locator:source.name,text}).format)?'code':'document',null,'unknown','',item.text.length,text!==item.text);
        summary.documents++;
      }
    }finally{db.close();}
  }
  await flush();await fs.writeFile(path.join(outputRoot,'preparation-manifest.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});return summary;
}


