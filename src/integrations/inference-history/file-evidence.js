import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crc32, gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import yauzl from 'yauzl';
import { runHistoryCallback } from './bounded-callback.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const defaults = { maxFileBytes: 128 * 1024 * 1024, maxExpandedBytes: 8 * 1024 ** 3,
  maxEntries: 400000, maxDepth: 4, maxFacts: 20000, maxJsonNodes: 1000000 };
const fields = new Set(['task_id','taskId','conversation_id','backing_conversation_id','session_id',
  'sessionId','widget_session_id','thread_id','model','model_slug','model_id','created_at','updated_at',
  'create_time','timestamp','start_time','end_time','cwd','working_directory','repo','repository',
  'repository_url','repo_url','branch','branch_name','commit','commit_sha','git_commit',
  'external_pull_request_id','pull_request_status','pr_url','role','channel','type','tool_name',
  'turn_status','exit_code','id','turn_id','message_id','previous_turn_id','parent','recipient',
  'name','tool','tool_call_id','call_id','command']);
const media = new Set(['png','jpeg','gif','webp','pdf','mp3','mp4','wav','ico','bmp','font']);
export function identifyEvidenceFormat(bytes) {
  const head = bytes.subarray(0,512), magic = head.subarray(0,16);
  if(magic.toString()==='SQLite format 3\0')return 'sqlite';
  if(head.subarray(0,4).equals(Buffer.from('504b0304','hex'))
    ||head.subarray(0,4).equals(Buffer.from('504b0506','hex')))return 'zip';
  if(head.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'png';
  if(head[0]===255&&head[1]===216)return 'jpeg';
  if(/^GIF8[79]a/.test(head.subarray(0,6).toString()))return 'gif';
  if(head.subarray(0,4).toString()==='%PDF')return 'pdf';
  if(head[0]===31&&head[1]===139)return 'gzip';
  if(head.subarray(257,262).toString()==='ustar')return 'tar';
  if(head.subarray(4,8).toString()==='ftyp')return 'mp4';
  if(head.subarray(0,3).toString()==='ID3'||head[0]===255&&(head[1]&224)===224)return 'mp3';
  if(head.subarray(0,4).toString()==='RIFF')return head.subarray(8,12).toString()==='WEBP'?'webp':'wav';
  if(head.subarray(0,2).toString()==='MZ'||head.subarray(0,4).equals(Buffer.from('7f454c46','hex')))return 'executable';
  if(head.subarray(0,4).equals(Buffer.from('00000100','hex')))return 'ico';
  if(head.subarray(0,2).toString()==='BM')return 'bmp';
  if(['wOFF','wOF2','OTTO'].includes(head.subarray(0,4).toString()))return 'font';
  try {
    const text=new TextDecoder('utf-8',{fatal:true}).decode(head,{stream:true}).replace(/^\uFEFF/,'').trimStart();
    if(head.includes(0))return 'binary_unknown';
    return /^[{[]/.test(text)?'json_candidate':/^<!doctype html|^<html/i.test(text)?'html':'text';
  } catch { return 'binary_unknown'; }
}
const safeName = name => typeof name==='string' && name.length<=4096 && !name.includes('\0')
  && !name.includes('\\') && !/^(?:\/|[a-z]:)/i.test(name)
  && !name.split('/').some(part=>part==='..');
/** Explicit private-host permission is required; content never enters logs or public fixtures. */
export async function extractFileEvidence({sourceRoot,outputRoot,authorizePaths,limits:input={},signal,onProgress,sourceNames=null}) {
  const limits={...defaults,...input};
  if(sourceNames!==null&&(!Array.isArray(sourceNames)||!sourceNames.length||sourceNames.length>limits.maxEntries
    ||new Set(sourceNames).size!==sourceNames.length||sourceNames.some(name=>!safeName(name)||name.includes('/'))))
    throw new TypeError('Explicit flat source names required.');
  if(Object.keys(input).some(key=>!(key in defaults))||Object.values(limits).some(value=>!Number.isSafeInteger(value)||value<1))
    throw new TypeError('Invalid file-evidence limits.');
  sourceRoot=path.resolve(sourceRoot);outputRoot=path.resolve(outputRoot);
  if(typeof authorizePaths!=='function'||await authorizePaths({sourceRoot,outputRoot})!==true)
    throw new Error('Explicit private source/output authorization required.');
  let ancestor=outputRoot;
  while(!(await fs.lstat(ancestor).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;})))ancestor=path.dirname(ancestor);
  if(await fs.realpath(ancestor)!==ancestor)throw new Error('Canonical output ancestor required.');
  const realSource=await fs.realpath(sourceRoot);
  if(realSource!==sourceRoot||outputRoot===sourceRoot||outputRoot.startsWith(sourceRoot+path.sep))
    throw new Error('Distinct canonical output required.');
  if(sourceNames)for(const name of sourceNames){const selected=await fs.lstat(path.join(sourceRoot,name));
    if(!selected.isFile()||selected.isSymbolicLink())throw new Error('Selected regular source file required.');}
  await fs.mkdir(outputRoot,{recursive:true});
  if(await fs.realpath(outputRoot)!==outputRoot)throw new Error('Canonical output required.');
  const catalogPath=path.join(outputRoot,'file-evidence.sqlite');
  if(await fs.lstat(catalogPath).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))
    throw new Error('Existing catalog preserved; choose a fresh output directory.');
  const db=new Database(catalogPath);
  db.pragma('journal_mode = WAL');db.pragma('synchronous = FULL');
  db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);'+
    'CREATE TABLE sources(id INTEGER PRIMARY KEY,parent_id INTEGER,ordinal INTEGER,name TEXT,bytes INTEGER,sha256 TEXT,format TEXT,status TEXT,detail TEXT);'+
    'CREATE TABLE blobs(sha256 TEXT PRIMARY KEY,data BLOB);'+
    'CREATE TABLE documents(sha256 TEXT PRIMARY KEY,format TEXT,text TEXT,schema_json TEXT,status TEXT);'+
    'CREATE TABLE facts(sha256 TEXT,json_path TEXT,kind TEXT,value TEXT,PRIMARY KEY(sha256,json_path,kind,value));'+
    'CREATE TABLE containers(sha256 TEXT PRIMARY KEY,source_id INTEGER,status TEXT);'+
    'CREATE TABLE features(sha256 TEXT,kind TEXT,count INTEGER,PRIMARY KEY(sha256,kind));'+
    'CREATE TABLE attachment_links(source_id INTEGER,document_sha256 TEXT,json_path TEXT,PRIMARY KEY(source_id,document_sha256,json_path));'+
    'CREATE INDEX source_top_name ON sources(name) WHERE parent_id IS NULL;'+
    'CREATE INDEX source_hash ON sources(sha256);CREATE INDEX fact_lookup ON facts(kind,value);');
  db.prepare('INSERT INTO meta VALUES (?,?)').run('format','private-file-evidence.v1');
  db.prepare('INSERT INTO meta VALUES (?,?)').run('sourceRoot',sourceRoot);
  db.prepare('INSERT INTO meta VALUES (?,?)').run('limits',JSON.stringify(limits));
  const add=db.prepare('INSERT INTO sources(parent_id,ordinal,name,bytes,sha256,format,status,detail) VALUES (?,?,?,?,?,?,?,?)');
  const update=db.prepare('UPDATE sources SET sha256=?,format=?,status=?,detail=? WHERE id=?');
  const blob=db.prepare('INSERT OR IGNORE INTO blobs VALUES (?,?)');
  const document=db.prepare('INSERT OR IGNORE INTO documents VALUES (?,?,?,?,?)');
  const feature=db.prepare('INSERT INTO features VALUES (?,?,1) ON CONFLICT(sha256,kind) DO UPDATE SET count=count+1');
  const fact=db.prepare('INSERT OR IGNORE INTO facts VALUES (?,?,?,?)');
  let expanded=0,entries=0,topFiles=0,topBytes=0,complete=true;
  const check=()=>signal?.throwIfAborted();
  const status=(id,digest,format,value,detail=null)=>{update.run(digest,format,value,detail,id);if(!['supported','recovered','duplicate_container','directory','asset_retained','recovered_tar_metadata'].includes(value))complete=false;};
  const parseDocument=(bytes,digest,format)=>{
    if(db.prepare('SELECT 1 FROM documents WHERE sha256=?').get(digest))return;
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}
    catch{document.run(digest,format,null,'{}','unsupported_encoding');return 'unsupported_encoding';}
    let root,schema={},mode=format,documentStatus='supported';
    if(format==='json_candidate'){
      try{root=JSON.parse(text);mode='json';}
      catch{try{root=text.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));mode='jsonl';}
      catch{documentStatus='invalid_json';}}
      if(root!==undefined)schema={rootType:Array.isArray(root)?'array':root===null?'null':typeof root,
        topKeys:root&&typeof root==='object'&&!Array.isArray(root)?Object.keys(root):[],
        rootRecords:Array.isArray(root)?root.length:1};
    }
    let count=0,visited=0;
    const put=(jsonPath,kind,value)=>{
      if(count>=limits.maxFacts){documentStatus='facts_limited';return;}
      if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'){
        const normalized=String(value);if(normalized.length<=4096){fact.run(digest,jsonPath,kind,normalized);count++;}
        else documentStatus='facts_limited';
      }
    };
    if(root!==undefined){
      const stack=[{value:root,at:'$',depth:0}];
      while(stack.length){
        if(++visited>limits.maxJsonNodes){documentStatus='facts_limited';break;}
        const {value,at,depth}=stack.pop();if(depth>128){documentStatus='facts_limited';continue;}
        if(!value||typeof value!=='object')continue;
        if(value.mapping&&typeof value.mapping==='object'&&typeof(value.conversation_id??value.id)==='string')
          put(at+'.id','conversation_id',value.conversation_id??value.id);
        if(Array.isArray(value.turns)&&typeof value.id==='string')put(at+'.id','task_id',value.id);
        for(const key of Object.keys(value)){
          const child=value[key],location=at+'.'+key;
          if(fields.has(key))put(location,key,child);
          if(['mapping','turns','input_items','output_items','tool_calls','output_diff','error','activity_messages','git_info'].includes(key))feature.run(digest,key);
          if(child&&typeof child==='object')stack.push({value:child,at:location,depth:depth+1});
        }
      }
    }
    for(const match of text.matchAll(/\b(?:[a-f0-9]{40}|[a-f0-9]{64})\b|https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/(?:pull|commit)\/[a-z0-9]+|\bfile_[a-f0-9]{32}\b|\bfile-[A-Za-z0-9]{12,64}\b/gi)){
      if(count>=limits.maxFacts){documentStatus='facts_limited';break;}
      put('@'+match.index,'text_reference',match[0]);
    }
    document.run(digest,mode,text,JSON.stringify(schema),documentStatus);
    return documentStatus;
  };
  const visit=async(bytes,id,depth,retain)=>{
    check();const digest=hash(bytes),format=identifyEvidenceFormat(bytes);
    if(retain)blob.run(digest,bytes);
    if(format==='zip'||format==='gzip'||format==='tar'){
      const prior=db.prepare('SELECT source_id,status FROM containers WHERE sha256=?').get(digest);
      if(prior){status(id,digest,format,'duplicate_container','expanded_source_id:'+prior.source_id);return;}
      if(depth>=limits.maxDepth){status(id,digest,format,'depth_limited');return;}
      db.prepare('INSERT INTO containers VALUES (?,?,?)').run(digest,id,'in_progress');
      try{
        if(format==='zip'){
          await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,autoClose:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
            if(error)return reject(error);zip.on('error',reject);zip.on('end',resolve);
            let ordinal=0;
            zip.on('entry',entry=>{(async()=>{
              check();const childId=Number(add.run(id,ordinal++,entry.fileName,entry.uncompressedSize,null,null,'pending',null).lastInsertRowid);
              entries++;
              if(entries>limits.maxEntries){status(childId,null,null,'entry_limited');return;}
              if(!safeName(entry.fileName)){status(childId,null,null,'unsafe_name');return;}
              const type=(entry.externalFileAttributes>>>16)&0o170000;
              if(type&&type!==0o100000&&type!==0o040000){status(childId,null,null,'unsupported_link_or_special');return;}
              if(entry.fileName.endsWith('/')){status(childId,null,null,'directory');return;}
              if(entry.generalPurposeBitFlag&1){status(childId,null,null,'encrypted');return;}
              if(entry.uncompressedSize>limits.maxFileBytes||expanded+entry.uncompressedSize>limits.maxExpandedBytes){
                status(childId,null,null,'size_limited');return;}
              let stream;
              try{
                stream=await new Promise((res,rej)=>zip.openReadStream(entry,(err,value)=>err?rej(err):res(value)));
                const chunks=[];let total=0,checksum=0;
                for await(const chunk of stream){check();total+=chunk.length;expanded+=chunk.length;
                  if(total>limits.maxFileBytes||expanded>limits.maxExpandedBytes)throw new Error('limit');
                  checksum=crc32(chunk,checksum);chunks.push(chunk);}
                if(total!==entry.uncompressedSize||checksum!==entry.crc32){status(childId,null,null,'corrupt_crc_or_size');return;}
                await visit(Buffer.concat(chunks),childId,depth+1,true);
              }catch{stream?.destroy();status(childId,null,null,'corrupt_or_read_failure');}
            })().then(()=>zip.readEntry(),error=>{zip.close();reject(error);});});
            zip.readEntry();
          }));
        }else if(format==='gzip'){
          const unpacked=gunzipSync(bytes,{maxOutputLength:Math.min(limits.maxFileBytes,limits.maxExpandedBytes-expanded)});
          expanded+=unpacked.length;const childId=Number(add.run(id,0,'gzip_payload',unpacked.length,null,null,'pending',null).lastInsertRowid);
          entries++;await visit(unpacked,childId,depth+1,true);
        }else{
          for(const entry of readTarEvidenceEntries(bytes)){
            const childId=Number(add.run(id,entry.ordinal,entry.name,entry.length,null,null,'pending',JSON.stringify(entry.detail)).lastInsertRowid);entries++;
            if(entries>limits.maxEntries||entry.length>limits.maxFileBytes||expanded+entry.length>limits.maxExpandedBytes)status(childId,null,null,'size_limited');
            else if(!safeName(entry.name))status(childId,null,null,'unsafe_name');
            else if(entry.metadata){const memberHash=hash(entry.body);blob.run(memberHash,entry.body);
              status(childId,memberHash,'tar_metadata','recovered_tar_metadata',JSON.stringify(entry.detail));expanded+=entry.length;}
            else if(entry.type==='5')status(childId,null,null,'directory',JSON.stringify(entry.detail));
            else if(Object.keys(entry.detail.pax).some(key=>key.startsWith('GNU.sparse')))status(childId,null,null,'unsupported_tar_sparse',JSON.stringify(entry.detail));
            else if(entry.type!=='0'&&entry.type!=='\0')status(childId,null,null,'unsupported_tar_metadata_or_link',JSON.stringify(entry.detail));
            else{expanded+=entry.length;await visit(entry.body,childId,depth+1,true);
              db.prepare('UPDATE sources SET detail=? WHERE id=?').run(JSON.stringify(entry.detail),childId);}
          }
        }
        db.prepare('UPDATE containers SET status=? WHERE sha256=?').run('recovered',digest);
        status(id,digest,format,'recovered');
      }catch(error){
        const failure=error?.code==='ERR_BUFFER_TOO_LARGE'?'size_limited_container':'corrupt_or_limited_container';
        db.prepare('UPDATE containers SET status=? WHERE sha256=?').run(failure,digest);
        status(id,digest,format,failure);
      }
    }else if(['json_candidate','text','html'].includes(format)){
      const result=parseDocument(bytes,digest,format);status(id,digest,format,result??'supported');
    }else if(media.has(format))status(id,digest,format,'asset_retained','No OCR, rendering, transcription or executable content processing.');
    else status(id,digest,format,'unsupported_format','Exact original or recovered blob retained; no execution or parser guess.');
  };
  try{
    for(const entry of (await fs.readdir(sourceRoot,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      if(sourceNames&&!sourceNames.includes(entry.name))continue;
      check();const file=path.join(sourceRoot,entry.name),stat=await fs.lstat(file);
      const id=Number(add.run(null,topFiles++,entry.name,stat.size,null,null,'pending',null).lastInsertRowid);topBytes+=stat.size;
      if(!entry.isFile()||stat.isSymbolicLink()){status(id,null,null,'unsupported_source_type');continue;}
      if(await fs.realpath(file)!==file){status(id,null,null,'unsafe_source_path');continue;}
      db.exec('BEGIN IMMEDIATE');
      try{
        if(stat.size<=limits.maxFileBytes)await visit(await fs.readFile(file),id,0,false);
        else{
          const digest=createHash('sha256');for await(const chunk of createReadStream(file)){check();digest.update(chunk);}
          status(id,digest.digest('hex'),null,'size_limited','Original retained; exceeds bounded parser budget.');
        }
        const after=await fs.stat(file);
        if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)throw new Error('source changed');
        db.exec('COMMIT');
      }catch{db.exec('ROLLBACK');status(id,null,null,'source_changed_or_read_failure');}
      if(topFiles%25===0)onProgress?.({topFiles,entries,expandedBytes:expanded});
    }
    db.exec("INSERT OR IGNORE INTO attachment_links SELECT sources.id,facts.sha256,facts.json_path FROM sources JOIN facts ON sources.parent_id IS NULL AND sources.name=facts.value||'.dat' WHERE facts.kind='text_reference'");
    const summary={version:'private-file-evidence.v1',topFiles,topBytes,entries,expandedBytes:expanded,complete,
      statuses:db.prepare('SELECT status,COUNT(*) AS count FROM sources GROUP BY status ORDER BY status').all(),
      formats:db.prepare('SELECT format,COUNT(*) AS count FROM sources GROUP BY format ORDER BY format').all(),
      documents:db.prepare('SELECT format,status,COUNT(*) AS count FROM documents GROUP BY format,status').all(),
      factKinds:db.prepare('SELECT kind,COUNT(*) AS count,COUNT(DISTINCT value) AS distinctValues FROM facts GROUP BY kind ORDER BY kind').all(),
      structuralFeatures:db.prepare('SELECT kind,SUM(count) AS occurrences,COUNT(*) AS documents FROM features GROUP BY kind').all(),
      exactAttachmentLinks:db.prepare('SELECT COUNT(*) AS count,COUNT(DISTINCT source_id) AS sources FROM attachment_links').get(),
      uniqueBlobs:db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(data)),0) AS bytes FROM blobs').get(),
      caveats:['Assets are preserved, not OCR/transcribed/rendered.','Facts are declarations or text mentions, not verified execution.',
        'Duplicate containers point to their first recovered source.','No original history vault or blocked saved snippet source was read.']};
    db.prepare('INSERT INTO meta VALUES (?,?)').run('summary',JSON.stringify(summary));
    db.pragma('wal_checkpoint(TRUNCATE)');
    await fs.writeFile(path.join(outputRoot,'summary.json'),JSON.stringify(summary,null,2)+'\n');
    return {...summary,catalogPath};
  }finally{db.close();}
}

/** Optional bounded document-text pass. Host supplies existing vetted parsers; no loader or network. */
export async function enrichFileEvidence({catalogPath,authorizeCatalog,extractDocument,signal}) {
  catalogPath=path.resolve(catalogPath);
  if(typeof authorizeCatalog!=='function'||await authorizeCatalog(catalogPath)!==true
    ||typeof extractDocument!=='function'||await fs.realpath(catalogPath)!==catalogPath)
    throw new Error('Explicit private catalog/parser authorization required.');
  const db=new Database(catalogPath,{fileMustExist:true});
  try {
    if(db.prepare("SELECT value FROM meta WHERE key='format'").get()?.value!=='private-file-evidence.v1'
      ||!db.prepare("SELECT value FROM meta WHERE key='summary'").get())
      throw new Error('Completed file-evidence catalog required.');
    const sourceRoot=db.prepare("SELECT value FROM meta WHERE key='sourceRoot'").get().value;
    db.exec('CREATE TABLE IF NOT EXISTS derived_documents(source_sha256 TEXT PRIMARY KEY,kind TEXT,status TEXT,text TEXT,metadata_json TEXT);');
    const rows=db.prepare("SELECT DISTINCT sha256,format FROM sources WHERE format='pdf' OR (format='zip' AND id IN (SELECT parent_id FROM sources WHERE name='word/document.xml')) ORDER BY sha256").all();
    const write=db.prepare('INSERT OR IGNORE INTO derived_documents VALUES (?,?,?,?,?)');
    for(const row of rows) {
      signal?.throwIfAborted();
      if(db.prepare('SELECT 1 FROM derived_documents WHERE source_sha256=?').get(row.sha256))continue;
      const stored=db.prepare('SELECT data FROM blobs WHERE sha256=?').get(row.sha256);
      let bytes=stored?.data;
      if(!bytes){
        const top=db.prepare('SELECT name FROM sources WHERE sha256=? AND parent_id IS NULL').get(row.sha256);
        if(!top||!safeName(top.name)||top.name.includes('/')){write.run(row.sha256,row.format,'source_unavailable',null,'{}');continue;}
        const file=path.join(sourceRoot,top.name);
        if(await fs.realpath(file)!==file){write.run(row.sha256,row.format,'source_changed',null,'{}');continue;}
        bytes=await fs.readFile(file);
      }
      if(hash(bytes)!==row.sha256){write.run(row.sha256,row.format,'source_changed',null,'{}');continue;}
      const kind=row.format==='pdf'?'pdf':'docx';
      let result;
      try{const callbackSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
        result=await runHistoryCallback(()=>extractDocument({kind,bytes,signal:callbackSignal}),callbackSignal);}catch{result={status:'extract_failed'};}
      if(!result||result.status!=='supported'||typeof result.text!=='string'
        ||Buffer.byteLength(result.text)>64*1024*1024){
        write.run(row.sha256,kind,['unsupported_scanned','unsupported_encrypted','oversize','missing_dependency'].includes(result?.status)?result.status:'extract_failed',null,'{}');
        continue;
      }
      // Metadata must be structured, bounded parser provenance, never warnings/raw payloads.
      const metadata={pages:Number.isSafeInteger(result.pages)?result.pages:null,
        extractor:typeof result.extractor==='string'?result.extractor.slice(0,128):null};
      write.run(row.sha256,kind,'supported',result.text,JSON.stringify(metadata));
      let matches=0;
      const put=db.prepare('INSERT OR IGNORE INTO facts VALUES (?,?,?,?)');
      for(const match of result.text.matchAll(/\b(?:[a-f0-9]{40}|[a-f0-9]{64})\b|https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/(?:pull|commit)\/[a-z0-9]+|\bfile_[a-f0-9]{32}\b|\bfile-[A-Za-z0-9]{12,64}\b/gi)){
        if(++matches>20000)break;
        put.run(row.sha256,'derived@'+match.index,'text_reference',match[0]);
      }
    }
    db.exec("INSERT OR IGNORE INTO attachment_links SELECT sources.id,facts.sha256,facts.json_path FROM sources JOIN facts ON sources.parent_id IS NULL AND sources.name=facts.value||'.dat' WHERE facts.kind='text_reference'");
    const summary={documents:db.prepare('SELECT kind,status,COUNT(*) AS count,SUM(length(text)) AS textChars FROM derived_documents GROUP BY kind,status').all(),
      candidates:rows.length,exactAttachmentLinks:db.prepare('SELECT COUNT(*) AS count,COUNT(DISTINCT source_id) AS sources FROM attachment_links').get()};
    await fs.writeFile(path.join(path.dirname(catalogPath),'document-summary.json'),JSON.stringify(summary,null,2)+'\n');
    return summary;
  } finally {db.close();}
}

/** Finish a committed extraction catalog after interruption; never reread/reimport originals. */
export async function finishFileEvidence({catalogPath,authorizeCatalog}) {
  catalogPath=path.resolve(catalogPath);
  if(typeof authorizeCatalog!=='function'||await authorizeCatalog(catalogPath)!==true
    ||await fs.realpath(catalogPath)!==catalogPath)throw new Error('Explicit private catalog authorization required.');
  const db=new Database(catalogPath,{fileMustExist:true});
  try{
    if(db.prepare("SELECT value FROM meta WHERE key='format'").get()?.value!=='private-file-evidence.v1')
      throw new Error('File-evidence catalog required.');
    if(db.prepare("SELECT COUNT(*) AS n FROM sources WHERE status='pending'").get().n)
      throw new Error('Pending sources preserved; extraction is not complete.');
    if(db.pragma('quick_check',{simple:true})!=='ok')throw new Error('Catalog integrity failure.');
    db.exec("CREATE INDEX IF NOT EXISTS source_top_name ON sources(name) WHERE parent_id IS NULL;"+
      "INSERT OR IGNORE INTO attachment_links SELECT sources.id,facts.sha256,facts.json_path FROM sources JOIN facts ON sources.parent_id IS NULL AND sources.name=facts.value||'.dat' WHERE facts.kind='text_reference'");
    const top=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM sources WHERE parent_id IS NULL').get();
    const members=db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(CASE WHEN sha256 IS NOT NULL THEN bytes ELSE 0 END),0) AS recoveredBytes FROM sources WHERE parent_id IS NOT NULL').get();
    const statuses=db.prepare('SELECT status,COUNT(*) AS count FROM sources GROUP BY status ORDER BY status').all();
    const summary={version:'private-file-evidence.v1',finalizedFromCommittedCatalog:true,topFiles:top.count,topBytes:top.bytes,
      entries:members.count,expandedRecoveredBytes:members.recoveredBytes,
      complete:statuses.every(row=>['supported','recovered','duplicate_container','directory','asset_retained','recovered_tar_metadata'].includes(row.status)),
      statuses,formats:db.prepare('SELECT format,COUNT(*) AS count FROM sources GROUP BY format ORDER BY format').all(),
      documents:db.prepare('SELECT format,status,COUNT(*) AS count FROM documents GROUP BY format,status').all(),
      factKinds:db.prepare('SELECT kind,COUNT(*) AS count,COUNT(DISTINCT value) AS distinctValues FROM facts GROUP BY kind ORDER BY kind').all(),
      structuralFeatures:db.prepare('SELECT kind,SUM(count) AS occurrences,COUNT(*) AS documents FROM features GROUP BY kind').all(),
      exactAttachmentLinks:db.prepare('SELECT COUNT(*) AS count,COUNT(DISTINCT source_id) AS sources FROM attachment_links').get(),
      uniqueBlobs:db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(data)),0) AS bytes FROM blobs').get(),
      integrity:'quick_check_ok',
      caveats:['No original history vault or blocked snippet source read.','Facts are source declarations/mentions, not verified execution.',
        'Duplicate containers link to their first expansion.','Media remains byte evidence; no OCR/transcription/rendering.']};
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('summary',JSON.stringify(summary));
    db.pragma('wal_checkpoint(TRUNCATE)');
    await fs.writeFile(path.join(path.dirname(catalogPath),'summary.json'),JSON.stringify(summary,null,2)+'\n');
    return summary;
  }finally{db.close();}
}

const tarOctal = value => parseInt(value.toString().replace(/\0.*$/s,'').trim()||'0',8);
const tarString = value => new TextDecoder('utf-8',{fatal:true}).decode(value).replace(/\0.*$/s,'');
function parsePax(bytes){
  const fields=Object.create(null);let offset=0;
  while(offset<bytes.length){
    const space=bytes.indexOf(32,offset);
    if(space<0||space-offset>10)throw new Error('Invalid PAX record.');
    const digits=bytes.subarray(offset,space).toString();
    if(!/^[1-9][0-9]*$/.test(digits))throw new Error('Invalid PAX length.');
    const length=Number(digits),end=offset+length;
    if(!Number.isSafeInteger(length)||end>bytes.length||end<=space+1||bytes[end-1]!==10)throw new Error('Invalid PAX bounds.');
    const value=tarString(bytes.subarray(space+1,end-1)),equal=value.indexOf('=');
    if(equal<1)throw new Error('Invalid PAX field.');
    fields[value.slice(0,equal)]=value.slice(equal+1);offset=end;
  }
  return fields;
}
export function* readTarEvidenceEntries(bytes){
  let offset=0,ordinal=0,pending=Object.create(null),global=Object.create(null),longName=null,longLink=null;
  while(offset+512<=bytes.length){
    const header=bytes.subarray(offset,offset+512);if(header.every(value=>value===0))return;
    const declared=tarOctal(header.subarray(148,156));let checksum=0;
    for(let index=0;index<512;index++)checksum+=index>=148&&index<156?32:header[index];
    if(checksum!==declared)throw new Error('Invalid TAR checksum.');
    const type=String.fromCharCode(header[156]),base=tarString(header.subarray(0,100)),
      prefix=header.subarray(257,262).toString()==='ustar'?tarString(header.subarray(345,500)):'',
      headerName=prefix?prefix+'/'+base:base;
    const metadata=['x','g','L','K'].includes(type),pax=metadata?{}:{...global,...pending};
    let length=tarOctal(header.subarray(124,136));
    if(!metadata&&pax.size!==undefined){
      if(!/^[0-9]+$/.test(pax.size))throw new Error('Invalid PAX size.');
      length=Number(pax.size);
    }
    if(!Number.isSafeInteger(length)||length<0||offset+512+length>bytes.length)throw new Error('Invalid TAR bounds.');
    const body=bytes.subarray(offset+512,offset+512+length),
      name=metadata?headerName:pax.path??longName??headerName,
      detail={headerName,headerSha256:hash(header),mode:tarOctal(header.subarray(100,108)),
        uid:tarOctal(header.subarray(108,116)),gid:tarOctal(header.subarray(116,124)),
        mtime:tarOctal(header.subarray(136,148)),linkTarget:metadata?null:pax.linkpath??longLink??tarString(header.subarray(157,257)),pax};
    if(type==='x')pending=parsePax(body);
    else if(type==='g')global={...global,...parsePax(body)};
    else if(type==='L')longName=tarString(body).replace(/\n$/,'');
    else if(type==='K')longLink=tarString(body).replace(/\n$/,'');
    else{pending=Object.create(null);longName=null;longLink=null;}
    yield {ordinal:ordinal++,name,type,body,length,detail,metadata};
    offset+=512+Math.ceil(length/512)*512;
  }
  if(offset!==bytes.length)throw new Error('Truncated TAR header.');
}
/** Recover retained PAX/GNU metadata and exact names without reextracting file contents. */
export async function recoverTarFileEvidenceMetadata({catalogPath,authorizeCatalog}){
  catalogPath=path.resolve(catalogPath);
  if(typeof authorizeCatalog!=='function'||await authorizeCatalog(catalogPath)!==true||await fs.realpath(catalogPath)!==catalogPath)
    throw new Error('Explicit private catalog authorization required.');
  const db=new Database(catalogPath,{fileMustExist:true});let metadataRecords=0,updatedNames=0;
  try{
    if(db.prepare("SELECT value FROM meta WHERE key='format'").get()?.value!=='private-file-evidence.v1')
      throw new Error('File-evidence catalog required.');
    for(const parent of db.prepare("SELECT id,sha256 FROM sources WHERE format='tar' AND status='recovered'").all()){
      const bytes=db.prepare('SELECT data FROM blobs WHERE sha256=?').get(parent.sha256)?.data;
      if(!bytes||hash(bytes)!==parent.sha256)throw new Error('Retained TAR bytes unavailable.');
      db.exec('BEGIN IMMEDIATE');
      try{
        for(const entry of readTarEvidenceEntries(bytes)){
          const row=db.prepare('SELECT id,name,bytes FROM sources WHERE parent_id=? AND ordinal=?').get(parent.id,entry.ordinal);
          if(!row||row.bytes!==entry.length)throw new Error('TAR source lineage mismatch.');
          if(!safeName(entry.name))continue;
          if(entry.name!==row.name)updatedNames++;
          if(entry.metadata){
            const digest=hash(entry.body);db.prepare('INSERT OR IGNORE INTO blobs VALUES (?,?)').run(digest,entry.body);
            db.prepare("UPDATE sources SET name=?,sha256=?,format='tar_metadata',status='recovered_tar_metadata',detail=? WHERE id=?")
              .run(entry.name,digest,JSON.stringify(entry.detail),row.id);metadataRecords++;
          }else db.prepare('UPDATE sources SET name=?,detail=? WHERE id=?').run(entry.name,JSON.stringify(entry.detail),row.id);
        }
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    const summary={metadataRecords,updatedNames,
      statuses:db.prepare('SELECT status,COUNT(*) AS count FROM sources GROUP BY status ORDER BY status').all(),
      integrity:db.pragma('quick_check',{simple:true})==='ok'?'quick_check_ok':'failed'};
    db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('tarMetadataRecovery',JSON.stringify(summary));
    db.pragma('wal_checkpoint(TRUNCATE)');
    await fs.writeFile(path.join(path.dirname(catalogPath),'tar-metadata-summary.json'),JSON.stringify(summary,null,2)+'\n');return summary;
  }finally{db.close();}
}

/** Metadata only: no pixels rendered, OCR, audio decoding or model execution. */
export async function enrichFileEvidenceMedia({catalogPath,authorizeCatalog,decodeMetadata,signal}){
  catalogPath=path.resolve(catalogPath);
  if(typeof authorizeCatalog!=='function'||await authorizeCatalog(catalogPath)!==true
    ||typeof decodeMetadata!=='function'||await fs.realpath(catalogPath)!==catalogPath)
    throw new Error('Explicit private catalog/metadata parser authorization required.');
  const db=new Database(catalogPath,{fileMustExist:true});
  try{
    if(db.prepare("SELECT value FROM meta WHERE key='format'").get()?.value!=='private-file-evidence.v1')
      throw new Error('File-evidence catalog required.');
    const root=db.prepare("SELECT value FROM meta WHERE key='sourceRoot'").get().value;
    db.exec('CREATE TABLE IF NOT EXISTS media_metadata(source_sha256 TEXT PRIMARY KEY,status TEXT,metadata_json TEXT);');
    const rows=db.prepare("SELECT DISTINCT sha256,format FROM sources WHERE format IN ('png','jpeg','gif','webp','bmp','ico') ORDER BY sha256").all();
    const write=db.prepare('INSERT OR IGNORE INTO media_metadata VALUES (?,?,?)');
    for(const row of rows){
      signal?.throwIfAborted();if(db.prepare('SELECT 1 FROM media_metadata WHERE source_sha256=?').get(row.sha256))continue;
      let bytes=db.prepare('SELECT data FROM blobs WHERE sha256=?').get(row.sha256)?.data;
      if(!bytes){const top=db.prepare('SELECT name FROM sources WHERE sha256=? AND parent_id IS NULL').get(row.sha256);
        if(!top||!safeName(top.name)||top.name.includes('/')){write.run(row.sha256,'source_unavailable','{}');continue;}
        const file=path.join(root,top.name);
        if(await fs.realpath(file)!==file){write.run(row.sha256,'source_changed','{}');continue;}
        bytes=await fs.readFile(file);}
      if(hash(bytes)!==row.sha256){write.run(row.sha256,'source_changed','{}');continue;}
      let result;
      try{const callbackSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
        result=await runHistoryCallback(()=>decodeMetadata({bytes,signal:callbackSignal}),callbackSignal);}catch{}
      if(!result||typeof result!=='object'){write.run(row.sha256,'decoder_failed','{}');continue;}
      const metadata={};
      for(const key of ['width','height','pages','pageHeight','orientation','channels','density','loop','depth','space','format','hasAlpha','isProgressive']){
        const value=result[key];if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)
          ||typeof value==='string'&&value.length<=64)metadata[key]=value;
      }
      if(Array.isArray(result.delay)&&result.delay.length<=10000&&result.delay.every(value=>Number.isFinite(value)&&value>=0))metadata.delay=result.delay;
      write.run(row.sha256,'supported',JSON.stringify(metadata));
    }
    const summary={candidates:rows.length,statuses:db.prepare('SELECT status,COUNT(*) AS count FROM media_metadata GROUP BY status').all()};
    db.pragma('wal_checkpoint(TRUNCATE)');
    await fs.writeFile(path.join(path.dirname(catalogPath),'media-summary.json'),JSON.stringify(summary,null,2)+'\n');return summary;
  }finally{db.close();}
}
