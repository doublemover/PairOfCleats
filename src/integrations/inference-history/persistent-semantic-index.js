import { historySemanticSpans, normalizeHistoryVector } from './semantic-values.js';
import { digest, historyError } from './common.js';
import { historyIndexState } from './generation.js';
import { createLocalHistorySemanticAdapter } from './semantic-adapter.js';
import { parseHistoryQuery, matchesHistoryHardConstraints } from './query.js';
import { runHistoryCallback } from './bounded-callback.js';

const invalid = () => historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid archive embedding controls.');
const visible = 'FROM units u JOIN records r ON r.id=u.record_id WHERE r.deleted=0 AND r.excluded=0';
/** Derived vectors live in the selected archive database, never the code index. */
export function createPersistentHistorySemanticIndex(db,runtime){
  const {config}=runtime,dimensions=config.profile.dimensions;
  db.exec([
    'CREATE TABLE IF NOT EXISTS history_embedding_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), identity TEXT NOT NULL, identity_key TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS history_embedding_units (unit_id TEXT PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE,content_hash TEXT NOT NULL,expected_spans INTEGER NOT NULL,complete INTEGER NOT NULL DEFAULT 0);',
    'CREATE TABLE IF NOT EXISTS history_embedding_spans (unit_id TEXT NOT NULL REFERENCES history_embedding_units(unit_id) ON DELETE CASCADE,start INTEGER NOT NULL,end INTEGER NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(unit_id,start,end));',
    'CREATE TRIGGER IF NOT EXISTS history_embedding_unit_changed AFTER UPDATE OF text,metadata ON units BEGIN DELETE FROM history_embedding_units WHERE unit_id=new.id; END;'
  ].join('\n'));
  const previous=db.prepare('SELECT identity_key FROM history_embedding_meta WHERE singleton=1').get();
  if(previous?.identity_key!==config.identityKey)db.transaction(()=>{
    db.prepare('DELETE FROM history_embedding_units').run();
    const {modelsDir:_path,localFilesOnly:_offline,batchSize:_batch,...identity}=config;
    db.prepare('INSERT OR REPLACE INTO history_embedding_meta VALUES (1,?,?)').run(JSON.stringify(identity),config.identityKey);
  })();
  const status=()=>{
    const total=db.prepare('SELECT count(*) AS n '+visible).get().n;
    const indexed=db.prepare('SELECT count(*) AS n '+visible+' AND EXISTS (SELECT 1 FROM history_embedding_units e WHERE e.unit_id=u.id AND e.complete=1)').get().n;
    const spans=db.prepare('SELECT count(*) AS n FROM history_embedding_spans e JOIN units u ON u.id=e.unit_id JOIN records r ON r.id=u.record_id WHERE r.deleted=0 AND r.excluded=0').get().n;
    return {identityKey:config.identityKey,modelId:config.modelId,modelVersion:config.profile.revision,dimensions,profile:config.profile,
      queryPrefix:config.queryPrefix,passagePrefix:config.passagePrefix,totalUnits:total,indexedUnits:indexed,pendingUnits:total-indexed,
      indexedSpans:spans,complete:indexed===total,generationRef:historyIndexState(db).generationRef,
      storage:'archive_sqlite',scope:'visible_redacted_projected_text',media:false};
  };
  let running=false;
  const refresh=async(options={})=>{
    if(running)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Archive embedding refresh already running.');
    const {maxUnits=100,maxMillis=30000,batchSize=config.batchSize,maxBatchChars=16000,signal:inputSignal}=options;
    if(Object.keys(options).some(k=>!['maxUnits','maxMillis','batchSize','maxBatchChars','signal'].includes(k))
      ||!Number.isSafeInteger(maxUnits)||maxUnits<1||maxUnits>1000000
      ||!Number.isSafeInteger(maxMillis)||maxMillis<100||maxMillis>600000
      ||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>64
      ||!Number.isSafeInteger(maxBatchChars)||maxBatchChars<config.chunkChars||maxBatchChars>256000)throw invalid();
    const signal=AbortSignal.any([AbortSignal.timeout(maxMillis),...(inputSignal?[inputSignal]:[])]);
    const generation=historyIndexState(db).generationRef;
    let encoded=0,reused=0,processed=0,batches=0,stopped=null;
    const check=()=>{signal.throwIfAborted();if(historyIndexState(db).generationRef!==generation)throw historyError('ERR_INFERENCE_HISTORY_STALE','Archive changed during embedding refresh.');};
    const upsert=db.prepare('INSERT OR REPLACE INTO history_embedding_spans VALUES (?,?,?,?)');
    const commit=db.transaction(rows=>{
      for(const {unitId,start,end,vector} of rows){const blob=Buffer.alloc(dimensions*4);vector.forEach((v,i)=>blob.writeFloatLE(v,i*4));upsert.run(unitId,start,end,blob);}
      for(const unitId of new Set(rows.map(r=>r.unitId)))db.prepare("UPDATE history_embedding_units SET complete=1 WHERE unit_id=? AND expected_spans=(SELECT count(*) FROM history_embedding_spans WHERE unit_id=?)").run(unitId,unitId);
    });
    let pending=[],chars=0,last='';
    const flush=async()=>{
      if(!pending.length)return;
      check();
      const results=await runHistoryCallback(()=>runtime.encodeBatch(pending.map(row=>row.text),{signal}),signal);
      check();
      if(!Array.isArray(results)||results.length!==pending.length)throw invalid();
      const rows=pending.map((row,i)=>({...row,vector:normalizeHistoryVector(results[i],dimensions)}));
      commit(rows);encoded+=rows.length;batches++;pending=[];chars=0;
    };
    running=true;
    try{
      while(processed<maxUnits){
        check();
        const units=db.prepare('SELECT u.id,u.text '+visible+' AND u.id>? AND NOT EXISTS (SELECT 1 FROM history_embedding_units e WHERE e.unit_id=u.id AND e.complete=1) ORDER BY u.id LIMIT ?').all(last,Math.min(100,maxUnits-processed));
        if(!units.length)break;
        for(const unit of units){
          check();last=unit.id;
          const spans=Array.from(historySemanticSpans(unit.text,config.chunkChars,config.overlapChars)),hash=digest(unit.text);
          const old=db.prepare('SELECT content_hash FROM history_embedding_units WHERE unit_id=?').get(unit.id);
          if(old?.content_hash!==hash)db.transaction(()=>{
            db.prepare('DELETE FROM history_embedding_units WHERE unit_id=?').run(unit.id);
            db.prepare('INSERT INTO history_embedding_units VALUES (?,?,?,0)').run(unit.id,hash,spans.length);
          })();
          const existing=new Set(db.prepare('SELECT start,end FROM history_embedding_spans WHERE unit_id=?').all(unit.id).map(s=>s.start+':'+s.end));
          for(const span of spans){
            if(existing.has(span.start+':'+span.end)){reused++;continue;}
            if(pending.length>=batchSize||chars+span.text.length>maxBatchChars)await flush();
            pending.push({...span,unitId:unit.id});chars+=span.text.length;
          }
          if(!spans.length)db.prepare('UPDATE history_embedding_units SET complete=1 WHERE unit_id=?').run(unit.id);
          processed++;
        }
      }
      await flush();
    }catch(error){
      if(signal.aborted)stopped=inputSignal?.aborted?'cancelled':'deadline';
      else throw error;
    }finally{running=false;}
    const coverage=status();
    return {...coverage,admittedUnits:processed,encodedSpans:encoded,reusedSpans:reused,batches,stopped,resumable:true,exhaustiveCoverage:coverage.complete};
  };
  const adapter=()=>{
    const coverage=status();
    if(!coverage.indexedSpans||!coverage.indexedUnits)return null;
    const generation=coverage.generationRef;
    return Object.freeze({...createLocalHistorySemanticAdapter({
      modelId:config.modelId,modelVersion:config.profile.revision,dimensions,indexGenerationRef:generation,
      contentManifestHash:digest(JSON.stringify([config.identityKey,generation,coverage.indexedUnits,coverage.indexedSpans])),
      encodeQuery:(query,options)=>runtime.encodeQuery(query,options),
      async searchIndex(query,{top,signal,request={}}){
        const vector=normalizeHistoryVector(query,dimensions),parsed=parseHistoryQuery(request.query);
        const history=request.includeHistory===true||request.snapshotRef!=null;
        const date=(value,end)=>value?.length===10?value+'T'+(end?'23:59:59.999':'00:00:00.000')+'Z':value??null;
        const from=date(request.dateFrom,false),to=date(request.dateTo,true),role=request.role??null,path=request.pathState??'all';
        const sql=[
          'SELECT e.unit_id AS sourceRef,e.start,e.end,e.vector,u.text,',
          "(SELECT s.snapshot_id FROM snapshot_units s WHERE s.unit_id=u.id AND (?=1 OR s.snapshot_id=r.latest_snapshot) AND (? IS NULL OR s.snapshot_id=?) AND (?='all' OR s.path_state=?) ORDER BY s.snapshot_id LIMIT 1) AS snapshotRef",
          'FROM history_embedding_spans e JOIN history_embedding_units done ON done.unit_id=e.unit_id JOIN units u ON u.id=e.unit_id JOIN records r ON r.id=u.record_id',
          "WHERE done.complete=1 AND r.deleted=0 AND r.excluded=0 AND (? IS NULL OR json_extract(u.metadata,'$.role')=?) AND (? IS NULL OR json_extract(u.metadata,'$.createdAt.utc')>=?) AND (? IS NULL OR json_extract(u.metadata,'$.createdAt.utc')<=?) ORDER BY e.unit_id,e.start"
        ].join(' ');
        const ranked=[];let matched=0,visited=0,lastSource='';
        for(const row of db.prepare(sql).iterate(history?1:0,request.snapshotRef??null,request.snapshotRef??null,path,path,role,role,from,from,to,to)){
          signal?.throwIfAborted();visited++;
          if(visited%100===0)await new Promise(resolve=>setImmediate(resolve));
          if(!row.snapshotRef||!matchesHistoryHardConstraints(row.text,parsed))continue;
          if(row.vector.length!==dimensions*4)throw historyError('ERR_INFERENCE_HISTORY_STORAGE','Invalid persisted archive vector.');
          let score=0;for(let i=0;i<dimensions;i++)score+=vector[i]*row.vector.readFloatLE(i*4);
          if(!Number.isFinite(score))throw historyError('ERR_INFERENCE_HISTORY_STORAGE','Invalid persisted archive vector.');
          const key=JSON.stringify([row.sourceRef,row.snapshotRef]);
          const previous=ranked.find(r=>r.key===key);
          if(lastSource!==key){matched++;lastSource=key;}
          if(previous){if(score>previous.score){previous.score=score;previous.span={start:row.start,end:row.end};}}
          else ranked.push({key,sourceRef:row.sourceRef,snapshotRef:row.snapshotRef,span:{start:row.start,end:row.end},score});
          ranked.sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key));
          if(ranked.length>top)ranked.pop();
        }
        return {candidates:ranked.map(({key:_key,score:_score,...row})=>row),complete:coverage.complete&&matched<=top};
      }
    }),coverage});
  };
  return Object.freeze({status,refresh,adapter});
}
