import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const referencePattern=()=>/\b(?:[a-f0-9]{40}|[a-f0-9]{64})\b|https:\/\/github\.com\/[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}\/(?:pull|commit)\/[a-z0-9]{1,64}\b|\bfile_[a-f0-9]{32}\b|\bfile-[A-Za-z0-9]{12,64}\b/gi;
const factFields=new Set(['id','task_id','taskId','conversation_id','backing_conversation_id','session_id','sessionId','widget_session_id','thread_id','model','model_slug','model_id','created_at','updated_at','create_time','timestamp','start_time','end_time','cwd','working_directory','repo','repository','repository_url','repo_url','branch','branch_name','commit','commit_sha','git_commit','external_pull_request_id','pull_request_status','pr_url','role','channel','type','tool_name','turn_status','exit_code','turn_id','message_id','previous_turn_id','parent','recipient','name','tool','tool_call_id','call_id','command']);
export function classifyBinaryEvidence(bytes,extension=''){
  if(bytes.length>=84&&84+50*bytes.readUInt32LE(80)===bytes.length){
    const triangles=bytes.readUInt32LE(80),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let nonfinite=0;
    for(let i=0;i<triangles;i++)for(let v=0;v<3;v++)for(let axis=0;axis<3;axis++){
      const value=bytes.readFloatLE(84+i*50+12+v*12+axis*4);if(!Number.isFinite(value)){nonfinite++;continue;}
      min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);}
    return {format:'binary_stl',status:'metadata_recovered',metadata:{triangles,nonfiniteCoordinates:nonfinite,
      bounds:triangles&&!nonfinite?{min,max}:null,units:'not_declared'}};
  }
  if(bytes.length>=12&&(bytes.readUInt32BE(0)===0x00010000||bytes.subarray(0,4).toString()==='OTTO')){
    const tables=bytes.readUInt16BE(4);if(tables>0&&tables<=512&&12+16*tables<=bytes.length){
      const tags=[];let valid=true;for(let i=0;i<tables;i++){const at=12+16*i,offset=bytes.readUInt32BE(at+8),length=bytes.readUInt32BE(at+12);
        if(offset+length>bytes.length)valid=false;tags.push(bytes.subarray(at,at+4).toString());}
      if(valid)return {format:'sfnt_font',status:'metadata_recovered',metadata:{tables,tags}};}}
  if(bytes.length>=6&&bytes.readUInt16LE(0)===0&&bytes.readUInt16LE(2)===1){
    const count=bytes.readUInt16LE(4),frames=[];if(count>0&&count<=256&&6+count*16<=bytes.length){
      for(let i=0;i<count;i++){const at=6+i*16,size=bytes.readUInt32LE(at+8),offset=bytes.readUInt32LE(at+12);
        if(offset+size>bytes.length)return {format:'ico',status:'corrupt_bounds',metadata:{}};
        frames.push({width:bytes[at]||256,height:bytes[at+1]||256,bitsPerPixel:bytes.readUInt16LE(at+6)});}
      return {format:'ico',status:'metadata_recovered',metadata:{frames}};}}
  if(bytes.length>=54&&bytes.subarray(0,2).toString()==='BM'){
    const dib=bytes.readUInt32LE(14),offset=bytes.readUInt32LE(10);
    if(dib>=40&&14+dib<=bytes.length&&offset<=bytes.length)return {format:'bmp',status:'metadata_recovered',
      metadata:{width:bytes.readInt32LE(18),height:bytes.readInt32LE(22),bitsPerPixel:bytes.readUInt16LE(28),compression:bytes.readUInt32LE(30)}};
  }
  if(bytes.length>=16&&bytes.readUInt32LE(0)===0x00035f3f)return {format:'legacy_winhelp',status:'identified_not_decoded',metadata:{bytes:bytes.length}};
  if(extension==='.odttf')return {format:'office_obfuscated_font',status:'key_required',metadata:{bytes:bytes.length}};
  if(bytes.length>=4&&bytes.subarray(0,2).toString()==='MZ'){
    const at=bytes.length>=64?bytes.readUInt32LE(60):0,signature=at+4<=bytes.length?bytes.subarray(at,at+4):null;
    return {format:signature?.equals(Buffer.from('50450000','hex'))?'pe_executable':signature?.subarray(0,2).toString()==='NE'?'ne_executable':'dos_mz_executable',status:'identified_not_executed',metadata:{bytes:bytes.length}};
  }
  if(bytes.length>=32&&bytes.readUInt32LE(0)===bytes.length&&bytes.readUInt32LE(4)===108000)return {
    format:'length_prefixed_raster_unresolved',status:'unresolved_codec',metadata:{widthField:bytes.readUInt16LE(8),heightField:bytes.readUInt16LE(10),depthField:bytes.readUInt16LE(12),marker:108000}};
  if(bytes.length>=8&&bytes.readUInt32LE(0)===0xabcdefab)return {format:'custom_mbd_unresolved',status:'unresolved_schema',
    metadata:{versionField:bytes.readUInt16LE(4),countField:bytes.readUInt16LE(6)}};
  return {format:'binary_unresolved',status:'unresolved_schema',metadata:{bytes:bytes.length}};
}
function* walkFacts(root){
  const stack=[{value:root,path:'$',depth:0,keys:null,index:0}];
  while(stack.length){const frame=stack.at(-1);if(frame.depth>128)throw new Error('JSON fact depth exceeded.');if(!frame.value||typeof frame.value!=='object'){stack.pop();continue;}
    if(frame.keys===null)frame.keys=Array.isArray(frame.value)?{length:frame.value.length}:Object.keys(frame.value);
    const length=frame.keys.length;if(frame.index>=length){stack.pop();continue;}
    const key=Array.isArray(frame.keys)?frame.keys[frame.index++]:String(frame.index++),value=frame.value[key],at=frame.path+'.'+key;
    yield {key,value,path:at};
    if(value&&typeof value==='object')stack.push({value,path:at,depth:frame.depth+1,keys:null,index:0});
  }
}
export async function recoverFileEvidenceGaps({catalogPath,authorizeCatalog,maxFacts=1000000,maxJsonBytes=32*1024*1024,signal}){
  catalogPath=path.resolve(catalogPath);
  if(typeof authorizeCatalog!=='function'||await authorizeCatalog(catalogPath)!==true||await fs.realpath(catalogPath)!==catalogPath
  ||!Number.isSafeInteger(maxFacts)||maxFacts<1||maxFacts>2000000||!Number.isSafeInteger(maxJsonBytes)||maxJsonBytes<1||maxJsonBytes>128*1024*1024)throw new Error('Explicit private catalog recovery authorization required.');
  const db=new Database(catalogPath,{fileMustExist:true});
  try{
    if(db.prepare("SELECT value FROM meta WHERE key='format'").get()?.value!=='private-file-evidence.v1')throw new Error('File-evidence catalog required.');
    const root=db.prepare("SELECT value FROM meta WHERE key='sourceRoot'").get().value;
    db.exec('CREATE TABLE IF NOT EXISTS format_recovery(sha256 TEXT PRIMARY KEY,format TEXT,status TEXT,text TEXT,metadata_json TEXT);'+
   'CREATE TABLE IF NOT EXISTS fact_index_recovery(sha256 TEXT PRIMARY KEY,status TEXT,fields INTEGER,reference_count INTEGER,limit_value INTEGER);');
    const rows=db.prepare("SELECT DISTINCT sha256,format,status FROM sources WHERE status IN ('unsupported_format','unsupported_encoding','invalid_json') AND sha256 IS NOT NULL").all();
    if(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='media_metadata'").get())for(const extra of db.prepare("SELECT source_sha256 AS sha256 FROM media_metadata WHERE status='decoder_failed'").all()){
      if(!rows.some(row=>row.sha256===extra.sha256))rows.push({...extra,format:'image',status:'metadata_decoder_failure'});}
    for(const row of rows){
      signal?.throwIfAborted();if(db.prepare('SELECT 1 FROM format_recovery WHERE sha256=?').get(row.sha256))continue;
      const source=db.prepare('SELECT name FROM sources WHERE sha256=? ORDER BY id LIMIT 1').get(row.sha256);
      let bytes=db.prepare('SELECT data FROM blobs WHERE sha256=?').get(row.sha256)?.data;
      if(!bytes){const file=path.join(root,source.name);if(await fs.realpath(file)!==file)throw new Error('Source path changed.');bytes=await fs.readFile(file);}
      if(digest(bytes)!==row.sha256)throw new Error('Source bytes changed.');
      let recovered,text=null;
      if(['unsupported_format','metadata_decoder_failure'].includes(row.status))recovered=classifyBinaryEvidence(bytes,path.extname(source.name).toLowerCase());
      else if(row.status==='unsupported_encoding'){
        const decoder=new TextDecoder('windows-1252',{fatal:true}),value=decoder.decode(bytes);
        const controls=[...value].filter(char=>char.charCodeAt(0)<32&&!'\r\n\t'.includes(char)).length;
        recovered=controls===0&&!bytes.includes(0)?{format:'text',status:'decoded_encoding_candidate',metadata:{encoding:'windows-1252',confidence:'candidate',originalEncodingNotDeclared:true}}:{format:'text',status:'unsupported_encoding',metadata:{}};
        if(recovered.status==='decoded_encoding_candidate')text=value;
      }else{
        text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        const ini=/^\s*\[[^\]\r\n]+\]\s*$/m.test(text)&&/^\s*[\w.-]+\s*=/m.test(text);
        recovered={format:ini?'ini':'text_log',status:'reclassified_text',metadata:{jsonParseFailed:true,classification:ini?'section_and_assignment_shape':'utf8_non_json',originalBytesRetained:true}};
      }
      db.prepare('INSERT INTO format_recovery VALUES (?,?,?,?,?)').run(row.sha256,recovered.format,recovered.status,text,JSON.stringify(recovered.metadata));
    }
    const limited=db.prepare("SELECT sha256,format,length(CAST(text AS BLOB)) AS bytes FROM documents WHERE status='facts_limited'").all();
    const put=db.prepare('INSERT OR IGNORE INTO facts VALUES (?,?,?,?)');
    for(const row of limited){
      signal?.throwIfAborted();if(db.prepare("SELECT 1 FROM fact_index_recovery WHERE sha256=? AND status='complete'").get(row.sha256))continue;
      let fields=0,references=0,status='complete';
      db.exec('BEGIN IMMEDIATE');
      try{
        if(row.format==='json'){
          if(row.bytes>maxJsonBytes)status='json_byte_limit';
          else{const raw=JSON.parse(db.prepare('SELECT text FROM documents WHERE sha256=?').get(row.sha256).text);
            for(const entry of walkFacts(raw)){if(fields>=maxFacts){status='fact_limit';break;}
              if(factFields.has(entry.key)&&['string','number','boolean'].includes(typeof entry.value)&&String(entry.value).length<=4096){
                put.run(row.sha256,entry.path,entry.key,String(entry.value));fields++;}
              if(fields%5000===0)signal?.throwIfAborted();}}
        }
        let offset=1,utf16Offset=0,tail='';const size=262144;
        while(true){
          const chunk=db.prepare('SELECT substr(text,?,?) AS chunk FROM documents WHERE sha256=?').get(offset,size,row.sha256).chunk;
          const final=!chunk,buffer=tail+chunk,cutoff=final?buffer.length:Math.max(0,buffer.length-512);
          for(const match of buffer.matchAll(referencePattern())){
            if(match.index+match[0].length>cutoff)continue;
            if(references>=maxFacts){status='reference_limit';break;}
            put.run(row.sha256,'@'+(utf16Offset+match.index),'text_reference',match[0]);references++;
          }
          if(status==='reference_limit')break;
          utf16Offset+=cutoff;tail=buffer.slice(cutoff);offset+=size;signal?.throwIfAborted();if(final)break;
        }
        db.prepare('INSERT OR REPLACE INTO fact_index_recovery VALUES (?,?,?,?,?)').run(row.sha256,status,fields,references,maxFacts);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    db.exec("INSERT OR IGNORE INTO attachment_links SELECT sources.id,facts.sha256,facts.json_path FROM sources JOIN facts ON sources.parent_id IS NULL AND sources.name=facts.value||'.dat' WHERE facts.kind='text_reference'");
    const summary={formats:db.prepare('SELECT format,status,COUNT(*) AS count FROM format_recovery GROUP BY format,status').all(),
      factIndexes:db.prepare('SELECT status,COUNT(*) AS count,SUM(fields) AS fields,SUM(reference_count) AS referenceCount FROM fact_index_recovery GROUP BY status').all(),
      exactAttachmentLinks:db.prepare('SELECT COUNT(*) AS count,COUNT(DISTINCT source_id) AS sources FROM attachment_links').get()};
    db.pragma('wal_checkpoint(TRUNCATE)');await fs.writeFile(path.join(path.dirname(catalogPath),'gap-recovery-summary.json'),JSON.stringify(summary,null,2)+'\n');return summary;
  }finally{db.close();}
}

/** Decode only a document-declared OpenXML font key; never guess keys or execute fonts. */
export function decodeObfuscatedFont(bytes, fontKey) {
  const hex=typeof fontKey==='string'?fontKey.replace(/[{}-]/g,''):'';
  if(!/^[a-fA-F0-9]{32}$/.test(hex)||bytes.length<32)throw new Error('Declared font key required.');
  const key=Buffer.from(hex,'hex').reverse(),decoded=Buffer.from(bytes);
  for(let i=0;i<32;i++)decoded[i]^=key[i%16];
  const classified=classifyBinaryEvidence(decoded);
  if(classified.format!=='sfnt_font'||classified.status!=='metadata_recovered')throw new Error('Decoded font structure invalid.');
  return {bytes:decoded,metadata:classified.metadata};
}

/** Preserve valid UTF-8 spans; display undecodable/control bytes as explicit escapes. */
export function decodeUtf8Evidence(bytes) {
  const parts=[],invalidByteOffsets=[],escapedControlOffsets=[];let start=0;
  const escape=(i,invalid)=>{if(i>start)parts.push(bytes.subarray(start,i).toString('utf8'));parts.push('\\x'+bytes[i].toString(16).padStart(2,'0').toUpperCase());(invalid?invalidByteOffsets:escapedControlOffsets).push(i);start=i+1;};
  for(let i=0;i<bytes.length;){
    const b=bytes[i];if(b<128){if(b<32&&![9,10,13].includes(b))escape(i,false);i++;continue;}
    const n=b>=0xc2&&b<=0xdf?2:b>=0xe0&&b<=0xef?3:b>=0xf0&&b<=0xf4?4:0;
    let valid=n>0&&i+n<=bytes.length;
    for(let j=1;valid&&j<n;j++)if((bytes[i+j]&0xc0)!==0x80)valid=false;
    if(valid&&((b===0xe0&&bytes[i+1]<0xa0)||(b===0xed&&bytes[i+1]>=0xa0)||(b===0xf0&&bytes[i+1]<0x90)||(b===0xf4&&bytes[i+1]>=0x90)))valid=false;
    if(!valid){escape(i,true);i++;}else i+=n;
  }
  if(start<bytes.length)parts.push(bytes.subarray(start).toString('utf8'));
  return {text:parts.join(''),metadata:{encoding:'valid_utf8_spans_with_byte_escapes',originalEncoding:'not_assumed',invalidByteOffsets,escapedControlOffsets,originalBytes:bytes.length}};
}
export async function recoverUtf8FileEvidence({catalogPath,sourceSha256,authorizeCatalog}) {
  catalogPath=path.resolve(catalogPath);
  if(!/^[a-f0-9]{64}$/.test(sourceSha256??'')||typeof authorizeCatalog!=='function'||await authorizeCatalog(catalogPath)!==true||await fs.realpath(catalogPath)!==catalogPath)throw new Error('Explicit encoding recovery authorization required.');
  const db=new Database(catalogPath,{fileMustExist:true});
  try{
    const source=db.prepare("SELECT 1 FROM sources WHERE sha256=? AND status='unsupported_encoding'").get(sourceSha256);
    const bytes=db.prepare('SELECT data FROM blobs WHERE sha256=?').get(sourceSha256)?.data;
    if(!source||!bytes||bytes.length>128*1024*1024||digest(bytes)!==sourceSha256)throw new Error('Bounded matching source required.');
    db.exec('CREATE TABLE IF NOT EXISTS encoding_recovery(source_sha256 TEXT PRIMARY KEY,status TEXT,text TEXT,metadata_json TEXT)');
    if(db.prepare('SELECT 1 FROM encoding_recovery WHERE source_sha256=?').get(sourceSha256))throw new Error('Prior encoding recovery preserved.');
    const decoded=decodeUtf8Evidence(bytes);
    db.prepare('INSERT INTO encoding_recovery VALUES (?,?,?,?)').run(sourceSha256,'utf8_segments_recovered',decoded.text,JSON.stringify(decoded.metadata));
    return {sourceSha256,status:'utf8_segments_recovered',textChars:decoded.text.length,invalidBytes:decoded.metadata.invalidByteOffsets.length,escapedControls:decoded.metadata.escapedControlOffsets.length};
  }finally{db.close();}
}
