import { historyError, projectHistoryText, redactHistoryText } from './common.js';
const invalid=()=>historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid owner privacy request.');
export function historyPrivacy(db,recordRef) {
  const row=db.prepare('SELECT policy FROM history_privacy WHERE record_id=?').get(recordRef);
  return row ? JSON.parse(row.policy) : {excluded:false,redactions:[],annotation:''};
}
export function privacyText(text,policy) {
  if (!policy.redactions.length) return text;
  const pattern=[...policy.redactions].sort((a,b)=>b.length-a.length).map(value=>value.split('').map(char=>String.fromCharCode(92)+'u'+char.charCodeAt(0).toString(16).padStart(4,'0')).join('')).join('|');
  return text.replace(new RegExp(pattern,'g'),'[REDACTED owner]');
}
export function privacyNode(node,policy) {
  return node && {...node,text:privacyText(node.text,policy),
    attachments:policy.redactions.length?[]:node.attachments};
}
export function validateHistoryPrivacy(request) {
  if (Object.keys(request).some(key=>!['recordRef','excluded','redactions','annotation','requestContext','partition','expectedGeneration'].includes(key))
    || !/^[a-f0-9]{64}$/.test(request.recordRef??'') || typeof request.excluded!=='boolean'
    || !Array.isArray(request.redactions) || request.redactions.length>32
    || request.redactions.some(value=>typeof value!=='string'||value.length<1||value.length>256)
    || typeof request.annotation!=='string'||request.annotation.length>2000) throw invalid();
  return {excluded:request.excluded,redactions:[...new Set(request.redactions)].sort(),
    annotation:redactHistoryText(request.annotation)};
}
export function updateHistoryPrivacy(db,request,visibleNode) {
  const policy=validateHistoryPrivacy(request), record=db.prepare('SELECT deleted FROM records WHERE id=?').get(request.recordRef);
  if (!record || record.deleted) throw invalid();
  const previous=historyPrivacy(db,request.recordRef);
  if (JSON.stringify(previous)===JSON.stringify(policy)) return {changed:false,policy};
  db.prepare('INSERT INTO history_privacy VALUES (?,?) ON CONFLICT(record_id) DO UPDATE SET policy=excluded.policy')
    .run(request.recordRef,JSON.stringify(policy));
  db.prepare('UPDATE records SET excluded=? WHERE id=?').run(policy.excluded?1:0,request.recordRef);
  const units=db.prepare('SELECT id,node_id,metadata FROM units WHERE record_id=? ORDER BY id').all(request.recordRef);
  if(units.length>100000)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Privacy update unit budget exceeded.');
  const snapshots=new Map(),started=Date.now();let rawBytes=0;
  for (const unit of units) {
    const metadata=JSON.parse(unit.metadata);
    if(Date.now()-started>30000)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Privacy update time budget exceeded.');
    const snapshotId=db.prepare('SELECT snapshot_id FROM snapshot_units WHERE unit_id=? ORDER BY snapshot_id LIMIT 1').get(unit.id)?.snapshot_id;
    if(!snapshotId)throw historyError('ERR_INFERENCE_HISTORY_STORAGE','Missing unit provenance.');
    if(!snapshots.has(snapshotId)){
      const row=db.prepare('SELECT source_kind,raw_json FROM snapshots WHERE id=?').get(snapshotId);
      rawBytes+=Buffer.byteLength(row.raw_json);
      if(rawBytes>64*1024*1024)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Privacy update evidence budget exceeded.');
      snapshots.set(snapshotId,{...row,raw:JSON.parse(row.raw_json)});
    }
    const snapshot=snapshots.get(snapshotId);
    const node=visibleNode(snapshot.raw,snapshot.source_kind,unit.node_id);
    const projection=projectHistoryText(privacyText(node?.text??'',policy),metadata.projection.characterBudget);
    // Metadata and provenance remain opaque; original text is retained only in raw storage.
    const publicMetadata={...metadata,projection:projection.metadata,ownerRedacted:policy.redactions.length>0};
    if(policy.redactions.length){publicMetadata.sourceDetails={};publicMetadata.messageId=null;}
    db.prepare('UPDATE units SET text=?,metadata=? WHERE id=?').run(projection.text,JSON.stringify(publicMetadata),unit.id);
  }
  db.prepare("INSERT INTO units_fts(units_fts) VALUES ('optimize')").run();
  return {changed:true,policy};
}
