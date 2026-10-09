import { randomUUID } from 'node:crypto';
import { openHistoryStore } from './store.js';
import { digest, historyError, redactHistoryText } from './common.js';

/** Host supplies a separate verified private root; no ordinary reader exposes this ledger. */
export function createHistoryAuditLedger({auditRoot,verifyPrivateVault}) {
  const partition=digest('history-audit.v1');
  const open=async()=> {
    const db=await openHistoryStore(auditRoot,partition,{create:true,verifyPrivateVault});
    db.pragma('synchronous = FULL');
    db.exec('CREATE TABLE IF NOT EXISTS audit_events (sequence INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, event TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL)');
    return db;
  };
  const append=async event=> {
    const db=await open();
    try {
      db.exec('BEGIN IMMEDIATE');
      const previous=db.prepare('SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1').get()?.hash??'';
      const id=randomUUID(), row={...event,version:'history-audit.v1',id,at:new Date().toISOString()};
      const serialized=JSON.stringify(row);
      if(Buffer.byteLength(serialized)>32768) throw historyError('ERR_INFERENCE_HISTORY_AUDIT','Audit event exceeds budget.');
      const hash=digest(previous+serialized);
      db.prepare('INSERT INTO audit_events(id,event,previous_hash,hash) VALUES(?,?,?,?)').run(id,serialized,previous,hash);
      db.exec('COMMIT');
      return {persisted:true,eventId:id};
    } finally {if(db.inTransaction)db.exec('ROLLBACK');db.close();}
  };
  const read=async({offset=0,top=20,scope}={})=>{
    if(!scope || ![scope.tenantId,scope.ownerType,scope.ownerId,scope.sourceScope].every(value=>typeof value==='string'&&value.length>0)) throw historyError('ERR_INFERENCE_HISTORY_DENIED','Authorized audit scope required.');
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isSafeInteger(top)||top<1||top>100)
      throw historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid audit page.');
    const db=await open();
    try {
      const rows=db.prepare("SELECT * FROM audit_events WHERE json_extract(event,'$.tenantId')=? AND json_extract(event,'$.ownerType')=? AND json_extract(event,'$.ownerId')=? AND json_extract(event,'$.sourceScope')=? ORDER BY sequence DESC LIMIT ? OFFSET ?").all(scope.tenantId,scope.ownerType,scope.ownerId,scope.sourceScope,top+1,offset);
      return {version:'history-audit.v1',events:rows.slice(0,top).map(row=>({...JSON.parse(row.event),
        sequence:row.sequence,hash:row.hash,previousHash:row.previous_hash})),nextOffset:rows.length>top?offset+top:null,
      caveat:'A local hash chain detects inconsistency; it is not an independently anchored tamper-proof log.'};
    } finally{db.close();}
  };
  return Object.freeze({append,read});
}
export function historyAuditEvent(request,access,outcome,result=null) {
  const query=typeof request.query==='string'?redactHistoryText(request.query).slice(0,4096):null;
  return {action:request.action,outcome,releaseState:outcome==='allowed'?'awaiting_final_checks':'not_released',
    principalId:access?.principalId??null,tenantId:access?.tenantId??null,ownerType:access?.ownerType??null,
    ownerId:access?.ownerId??null,sourceScope:access?.sourceScope??null,policyEpoch:access?.policyEpoch??null,
    query,queryTruncated:typeof request.query==='string' && request.query.length>4096,
    refs:Object.fromEntries(['sourceRef','snapshotRef','recordRef','importRef'].filter(key=>/^[a-f0-9]{64}$/.test(request[key]??'')).map(key=>[key,request[key]])),
    settings:Object.fromEntries(['role','dateFrom','dateTo','pathState','match','mode','top','offset','candidateLimit','rerank']
      .filter(key=>typeof request[key]==='boolean'||typeof request[key]==='number'||typeof request[key]==='string')
      .map(key=>[key,typeof request[key]==='string'?redactHistoryText(request[key]).slice(0,256):request[key]])),
    generationRef:result?.index?.generationRef??null,returned:result?.hits?.length??result?.messages?.length??null,
    instructionAuthority:'none'};
}
