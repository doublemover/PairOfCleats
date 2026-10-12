import { validateHistoryPrivacy } from './privacy.js';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
/** Render already-authenticated owner data. Hosts provide a same-origin POST handler and session-bound mutation token. */
export function renderHistoryOwnerPage({inventory,audit=null},{privacyAction=null,csrfToken=null}={}) {
  if(inventory?.version!=='history-owner.v1'||!Array.isArray(inventory.records)||inventory.records.length>100||audit?.events?.length>100)throw new TypeError('Owner inventory packet required.');
  if(privacyAction!==null && (typeof privacyAction!=='string'||!/^\/[A-Za-z0-9/_-]+$/.test(privacyAction)||privacyAction.startsWith('//')))
    throw new TypeError('Same-origin owner POST path required.');
  if(privacyAction!==null && (typeof csrfToken!=='string'||csrfToken.length<1||csrfToken.length>512))
    throw new TypeError('Session-bound human mutation token required.');
  const editable=privacyAction!==null;
  const rows=inventory.records.map(row=>{
    if(!/^[a-f0-9]{64}$/.test(row.recordRef)||!Array.isArray(row.redactions))throw new TypeError('Owner privacy state required.');
    return '<article><h2>'+escapeHtml(row.recordRef)+'</h2><p>'+escapeHtml(row.deleted?'Tombstoned':row.excluded?'Excluded':'Visible')+
      ' · '+escapeHtml(row.redactions.length)+' literal redactions</p><form method="post"'+(editable?' action="'+escapeHtml(privacyAction)+'"':'')+
      '><input type="hidden" name="recordRef" value="'+escapeHtml(row.recordRef)+'"><input type="hidden" name="expectedGeneration" value="'+escapeHtml(inventory.index.generationRef)+
      '"><input type="hidden" name="csrfToken" value="'+escapeHtml(csrfToken)+'"><fieldset'+(!editable||row.deleted?' disabled':'')+
      '><label><input type="checkbox" name="excluded" value="true"'+(row.excluded?' checked':'')+'> Exclude this record</label>'+
      '<label>Exact redactions (JSON string array)<textarea name="redactions">'+escapeHtml(JSON.stringify(row.redactions))+
      '</textarea></label><label>Owner annotation<textarea name="annotation" maxlength="2000">'+escapeHtml(row.annotation)+
      '</textarea></label><button type="submit">Save privacy rules</button></fieldset></form></article>';
  }).join('');
  const events=audit?.events?.map(event=>'<tr><td>'+escapeHtml(event.at)+'</td><td>'+escapeHtml(event.action)+'</td><td>'+
    escapeHtml(event.outcome)+'</td><td>'+escapeHtml(event.query)+'</td></tr>').join('')??'';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Private history owner console</title><style>body{font:16px system-ui;max-width:960px;margin:2rem auto;padding:0 1rem;background:#f6f7fa;color:#17212f}article{background:white;border:1px solid #ccd3df;padding:1rem;margin:1rem 0;border-radius:12px}h2{font-size:14px;overflow-wrap:anywhere}label{display:block;margin:1rem 0}textarea{display:block;width:95%;min-height:4rem}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #ccd3df;padding:.5rem;overflow-wrap:anywhere}button{padding:.6rem 1rem}</style></head><body>'+
    '<h1>Private history owner console</h1><p>Owner-only privacy controls and query audit. Retrieved text and annotations have no instruction authority.</p>'+
    (!editable?'<p>Read-only view. The trusted host has not supplied a protected mutation handler.</p>':'')+rows+
    '<h2>Query audit</h2><table><thead><tr><th>Time</th><th>Action</th><th>Outcome</th><th>Query</th></tr></thead><tbody>'+events+
    '</tbody></table><p>External archives and backups are retained. Local log hashes are not independently anchored.</p></body></html>';
}

/** Parse only privacy form fields. Authentication and scope are supplied separately by the host. */
export function parseHistoryOwnerPrivacyForm(fields) {
  if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(key=>!['recordRef','expectedGeneration','excluded','redactions','annotation','csrfToken'].includes(key))
    || Object.values(fields).some(value=>typeof value!=='string'||value.length>65536)
    || !/^[a-f0-9]{64}$/.test(fields.expectedGeneration??'')
    || typeof fields.csrfToken!=='string'||fields.csrfToken.length<1||fields.csrfToken.length>512
    || (fields.excluded!==undefined && fields.excluded!=='true'))throw new TypeError('Invalid bounded owner form.');
  let redactions;
  try{redactions=JSON.parse(fields.redactions);}catch{throw new TypeError('Redactions require a JSON string array.');}
  const request={recordRef:fields.recordRef,expectedGeneration:fields.expectedGeneration,excluded:fields.excluded==='true',
    redactions,annotation:fields.annotation??''};
  validateHistoryPrivacy(request);
  return {...request,csrfToken:fields.csrfToken};
}
