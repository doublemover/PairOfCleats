import { isLocalSourceHistoryService } from './service.js';
import { createHistoryAgentReader } from './agent-reader.js';
const commands=new Set(['help','search','context','timeline','references','original','member']);
const failed=(code)=>({version:'history-agent-broker.v1',ok:false,error:{code,message:'Broker request denied without releasing evidence.'}});
/** Narrow transport-independent agent broker. Transport facts are supplied out of band by the host. */
export function createHistoryAgentBroker({service,boundary}) {
  if(isLocalSourceHistoryService(service)||!service||typeof boundary?.bind!=='function')throw new TypeError('Isolated authenticated broker host required.');
  return async function execute(serialized,transport){
    try{
      if(typeof serialized!=='string'||Buffer.byteLength(serialized)>16384)return failed('INPUT_BUDGET');
      const envelope=JSON.parse(serialized);
      if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).some(key=>!['command','request','options'].includes(key))
        || !commands.has(envelope.command))return failed('INVALID_REQUEST');
      const bound=await boundary.bind(transport,'agent'),session=bound.session;
      const reader=createHistoryAgentReader({service,requestContext:session.requestContext,partition:session.partition});
      await bound.recheck();
      const packet=await reader.execute(envelope.command,envelope.request??{},envelope.options??{});
      await bound.recheck();
      return {version:'history-agent-broker.v1',ok:packet.ok,packet,instructionAuthority:'none'};
    }catch(error){return failed(['ERR_INFERENCE_HISTORY_DENIED','ERR_INFERENCE_HISTORY_UNAVAILABLE'].includes(error?.code)?error.code:'INVALID_REQUEST');}
  };
}
