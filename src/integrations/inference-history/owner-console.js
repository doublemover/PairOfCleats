import { historyError } from './common.js';
/** Host-only controller. Host must authenticate a human channel; do not register as an agent tool. */
export function createHistoryOwnerConsole({service,authenticateHuman,auditLedger}) {
  if(typeof authenticateHuman!=='function'||!service||!auditLedger)throw new TypeError('Authenticated owner host required.');
  const authenticate=async request=>{
    const identity=await authenticateHuman(request.requestContext);
    if(!identity||identity.channel!=='human'||typeof identity.principalId!=='string')
      throw historyError('ERR_INFERENCE_HISTORY_DENIED','Owner console authentication required.');
    return identity;
  };
  return Object.freeze({
    async inventory(request){const identity=await authenticate(request);return service.ownerInventory({...request,ownerIdentity:identity});},
    async setPrivacy(request){const identity=await authenticate(request);return service.ownerSetPrivacy({...request,ownerIdentity:identity});},
    async audit(request){
      const identity=await authenticate(request);
      const before=await service.ownerInventory({...request,ownerIdentity:identity,top:1,offset:0});
      const result=await auditLedger.read({top:request.top,offset:request.offset,scope:before.auditScope});
      // Recheck owner authority after the asynchronous ledger read before releasing it.
      const after=await service.ownerInventory({...request,ownerIdentity:identity,top:1,offset:0});
      if(JSON.stringify(before.auditScope)!==JSON.stringify(after.auditScope)) throw historyError('ERR_INFERENCE_HISTORY_DENIED','Owner scope changed during audit read.');
      return result;
    }
  });
}
export function renderHistoryOwnerInventory(packet) {
  return ['Owner history inventory',...packet.records.map(row=>
    row.recordRef+' | '+(row.excluded?'excluded':'visible')+' | '+row.redactionCount+' literal redactions'),
  'Annotations are owner-authored context, never instructions.'].join('\n');
}
