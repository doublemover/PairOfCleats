import { isLocalSourceHistoryService } from './service.js';
import { historyError } from './common.js';
import { renderHistoryOwnerPage } from './owner-page.js';
const denied=message=>historyError('ERR_INFERENCE_HISTORY_DENIED',message);
/** Host-only human controller. Never register it as an agent tool. */
export function createHistoryOwnerConsole({service,authenticateHuman,auditLedger,verifyHumanMutation=null}) {
  if(isLocalSourceHistoryService(service)||typeof authenticateHuman!=='function'||!service||!auditLedger)throw new TypeError('Authenticated owner host required.');
  const authenticate=async request=>{
    let identity;try{identity=await authenticateHuman(request.requestContext);}catch{throw denied('Owner console authentication required.');}
    if(!identity||identity.channel!=='human'||typeof identity.principalId!=='string')throw denied('Owner console authentication required.');
    return identity;
  };
  const auditFor=async(request,identity)=>{
    const before=await service.ownerInventory({...request,ownerIdentity:identity,top:1,offset:0});
    const result=await auditLedger.read({top:request.top,offset:request.offset,scope:before.auditScope});
    const after=await service.ownerInventory({...request,ownerIdentity:identity,top:1,offset:0});
    if(JSON.stringify(before.auditScope)!==JSON.stringify(after.auditScope))throw denied('Owner scope changed during audit read.');
    return {...result,indexGenerationRef:after.index.generationRef};
  };
  return Object.freeze({
    async inventory(request){const identity=await authenticate(request);return service.ownerInventory({...request,ownerIdentity:identity});},
    async setPrivacy(request){
      const identity=await authenticate(request);
      let verified=false;try{verified=typeof verifyHumanMutation==='function' && await verifyHumanMutation({requestContext:request.requestContext,csrfToken:request.csrfToken})===true;}catch{}
      if(!verified)throw denied('Verified human mutation token required.');
      const {csrfToken:_privateToken,...input}=request;
      return service.ownerSetPrivacy({...input,ownerIdentity:identity});
    },
    async page(request,options={}){
      const identity=await authenticate(request);
      const inventory=await service.ownerInventory({...request,ownerIdentity:identity});
      const audit=await auditFor(request,identity);
      if(inventory.index.generationRef!==audit.indexGenerationRef)throw historyError('ERR_INFERENCE_HISTORY_STALE','Owner inventory changed during page read.');
      return renderHistoryOwnerPage({inventory,audit},options);
    },
    async audit(request){return auditFor(request,await authenticate(request));}
  });
}
export function renderHistoryOwnerInventory(packet) {
  return ['Owner history inventory',...packet.records.map(row=>
    row.recordRef+' | '+(row.excluded?'excluded':'visible')+' | '+row.redactionCount+' literal redactions'),
  'Annotations are owner-authored context, never instructions.'].join('\n');
}
