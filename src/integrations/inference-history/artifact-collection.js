import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { digest, historyError } from './common.js';
import { readVisibleContext, visibleNode, READ_GUARDS } from './reader.js';

export function readDocumentContext(db,request) {
  const base=readVisibleContext(db,request);
  if(!base||base.evidenceKind!=='recovered_artifact'||!base.anchorVisible||request.timeline)return base;
  const raw=JSON.parse(db.prepare('SELECT raw_json FROM snapshots WHERE id=?').get(request.snapshotRef).raw_json);
  const p=raw.provenance;
  const rows=db.prepare("SELECT s.id snapshotRef,u.id sourceRef,s.raw_json FROM snapshots s JOIN records r ON r.latest_snapshot=s.id JOIN snapshot_units su ON su.snapshot_id=s.id JOIN units u ON u.id=su.unit_id WHERE s.source_kind='recovered_artifact' AND r.deleted=0 AND r.excluded=0 AND json_extract(s.raw_json,'$.provenance.source_sha256')=? AND json_extract(s.raw_json,'$.provenance.locator')=? AND json_extract(s.raw_json,'$.artifact_kind')=? ORDER BY json_extract(s.raw_json,'$.provenance.chunk_start'),s.id").all(p.source_sha256,p.locator,raw.artifact_kind);
  const anchor=rows.findIndex(r=>r.sourceRef===request.sourceRef),top=base.limits.top;
  if(anchor<0)return base;
  const start=request.offset??Math.max(0,anchor-Math.min(base.limits.before,top-1));
  const end=request.offset!=null?start+top:Math.min(start+top,anchor+base.limits.after+1);
  const messages=[],guards=[];
  for(const row of rows.slice(start,end)){
    const part=readVisibleContext(db,{...request,sourceRef:row.sourceRef,snapshotRef:row.snapshotRef,before:0,after:0,top:1,offset:0});
    if(!part)continue;guards.push(...(part[READ_GUARDS]??[]));
    for(const message of part.messages)messages.push({...message,snapshotRef:row.snapshotRef,
      anchor:row.sourceRef===request.sourceRef,provenance:JSON.parse(row.raw_json).provenance});
  }
  return {...base,messages,scope:'adjacent_artifact_chunks',order:'chunk_start',totalVisibleMessages:rows.length,
    anchorIndex:anchor,offset:start,nextOffset:end<rows.length?end:null,previousOffset:start?Math.max(0,start-top):null,[READ_GUARDS]:guards};
}

export async function openArtifactCatalogs(bindings=[]) {
  if(!Array.isArray(bindings)||bindings.length>8)throw new Error('Bounded selected artifact catalogs required.');
  const catalogs=[];
  try{
    for(const binding of bindings){
      const file=path.resolve(binding.path),root=path.resolve(binding.sourceRoot);
      if(!path.isAbsolute(binding.path)||!path.isAbsolute(binding.sourceRoot)
        ||await fs.realpath(file)!==file||await fs.realpath(root)!==root)throw new Error('Canonical selected catalog/root required.');
      const db=new Database(file,{readonly:true,fileMustExist:true});
      if(db.prepare("SELECT value FROM meta WHERE key='format'").get()?.value!=='private-file-evidence.v1'){db.close();throw new Error('File evidence catalog required.');}
      catalogs.push({db,file,root});
    }
  }catch(error){for(const c of catalogs)c.db.close();throw error;}
  const targets=(index,kind,id)=>{
    const rows=kind==='conversation'
      ?index.prepare("SELECT s.id snapshotRef,u.id sourceRef FROM snapshots s JOIN records r ON r.latest_snapshot=s.id JOIN snapshot_units su ON su.snapshot_id=s.id JOIN units u ON u.id=su.unit_id WHERE s.source_kind='exported_conversation' AND s.source_id=? AND r.deleted=0 AND r.excluded=0 LIMIT 5").all(id)
      :index.prepare("SELECT su.snapshot_id snapshotRef,u.id sourceRef FROM units u JOIN records r ON r.id=u.record_id JOIN snapshot_units su ON su.unit_id=u.id AND su.snapshot_id=r.latest_snapshot WHERE json_extract(u.metadata,'$.sourceDetails.sourceSha256')=? AND r.deleted=0 AND r.excluded=0 LIMIT 5").all(id);
    return {state:rows.length?'indexed':'not_in_selected_collection',targets:rows};
  };
  const relations=(index,raw)=>{
    const sha=raw?.provenance?.source_sha256,conversation=raw?.conversation_id??raw?.id,out=[];
    for(const c of catalogs){
      if(sha){
        for(const link of c.db.prepare('SELECT s.sha256,s.name,a.json_path FROM attachment_links a JOIN sources s ON s.id=a.source_id WHERE a.document_sha256=? LIMIT 100').all(sha))
          out.push({relation:'exact_file_reference',sourceSha256:sha,targetSha256:link.sha256,fileId:link.name.replace(/\.dat$/i,''),evidencePointer:link.json_path,...targets(index,'artifact',link.sha256)});
        const doc=c.db.prepare("SELECT text FROM documents WHERE sha256=? AND format='json'").get(sha);
        if(doc){let value;try{value=JSON.parse(doc.text);}catch{}
          if(typeof value?.backing_conversation_id==='string')out.push({relation:'declared_backing_conversation',sourceSha256:sha,conversationId:value.backing_conversation_id,widgetId:value.widget_session_id??null,evidencePointer:'/backing_conversation_id',...targets(index,'conversation',value.backing_conversation_id)});}
      }
      if(raw?.mapping){
        for(const node of Object.values(raw.mapping)){
          if(!visibleNode(raw,'exported_conversation',node?.id))continue;
          for(const attachment of node?.message?.metadata?.attachments??[]){
            const id=attachment?.id??attachment?.file_id;if(typeof id!=='string')continue;
            const found=c.db.prepare('SELECT sha256 FROM sources WHERE parent_id IS NULL AND name=? LIMIT 1').get(id+'.dat');
            if(found)out.push({relation:'declared_message_attachment',conversationId:conversation,messageId:node.message.id??null,fileId:id,targetSha256:found.sha256,...targets(index,'artifact',found.sha256)});
          }
          if(out.length>=100)break;
        }
      }
    }
    return out.slice(0,100);
  };
  const original=async raw=>{
    const sha=raw.provenance.source_sha256;
    for(const c of catalogs){
      const row=c.db.prepare('SELECT * FROM sources WHERE sha256=? ORDER BY name=? DESC,parent_id IS NOT NULL,id LIMIT 1').get(sha,raw.provenance.locator);
      if(!row)continue;
      const sourceIdentities=c.db.prepare('SELECT id sourceId,parent_id parentId,name,sha256 FROM sources WHERE sha256=? ORDER BY id LIMIT 20').all(sha);
      const totalSourceIdentities=c.db.prepare('SELECT count(*) count FROM sources WHERE sha256=?').get(sha).count;
      const identity={resolutionBasis:row.name===raw.provenance.locator?'exact_locator_and_hash':'content_hash',sourceIdentities,totalSourceIdentities};
      const lineage=[];for(let s=row;s;s=s.parent_id==null?null:c.db.prepare('SELECT * FROM sources WHERE id=?').get(s.parent_id)){
        lineage.unshift({sourceId:s.id,name:s.name,sha256:s.sha256});if(lineage.length>128)throw new Error('Container depth exceeded.');
      }
      let bytes,location;
      if(row.parent_id==null){
        const file=path.resolve(c.root,row.name),relative=path.relative(c.root,file);
        if(relative.startsWith('..')||path.isAbsolute(relative)||await fs.realpath(file)!==file)throw new Error('Original escaped selected source root.');
        const stat=await fs.stat(file);if(stat.size>512*1024*1024)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Original byte limit exceeded.');
        bytes=await fs.readFile(file);location={path:file};
      }else{
        bytes=c.db.prepare('SELECT data FROM blobs WHERE sha256=?').get(sha)?.data;
        location={catalogPath:c.file,blobSha256:sha};
      }
      if(!bytes)return {state:'preserved_source_not_materialized',sourceSha256:sha,lineage,location,...identity};
      if(digest(bytes)!==sha)throw historyError('ERR_INFERENCE_HISTORY_INPUT','Preserved original hash changed.');
      return {state:'verified_original',sourceSha256:sha,bytes:bytes.length,format:row.format,lineage,location,...identity,
        ...(bytes.length<=16384?{base64:bytes.toString('base64')}:{}),instructionAuthority:'none'};
    }
    return {state:'not_in_selected_catalogs',sourceSha256:sha};
  };
  return {original,relations,close(){for(const c of catalogs)c.db.close();}};
}
