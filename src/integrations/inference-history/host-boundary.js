import { runHistoryCallback } from './bounded-callback.js';
import { historyError } from './common.js';
const denied=()=>historyError('ERR_INFERENCE_HISTORY_DENIED','Authenticated host session required.');
const unavailable=()=>historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE','Verified host isolation required.');
const identity=session=>JSON.stringify([session.sessionId,session.principalId,session.partition,session.channel,session.policyEpoch]);
/** Host attestations are a deployment prerequisite, not an OS sandbox or credential issuer. */
export function createHistoryHostBoundary({resolveSession,verifyIsolation,now=Date.now}) {
  if(typeof resolveSession!=='function'||typeof verifyIsolation!=='function'||typeof now!=='function')throw unavailable();
  const isolation=async transport=>{
    let proof;try{proof=await runHistoryCallback(()=>verifyIsolation(transport),AbortSignal.timeout(5000));}catch{throw unavailable();}
    if(!proof||proof.verified!==true||proof.auditSinkIsolated!==true||proof.humanChannelIsolated!==true
      || !['separate_os_principal','separate_host'].includes(proof.mode)
      || typeof proof.policyEpoch!=='string'||!proof.policyEpoch||proof.policyEpoch.length>200)throw unavailable();
    return JSON.stringify([proof.mode,proof.policyEpoch]);
  };
  const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)throw denied();return value;};
  const sessionFor=async transport=>{
    let session;try{session=await runHistoryCallback(()=>resolveSession(transport),AbortSignal.timeout(5000));}catch{throw denied();}
    if(!session||!['human','agent'].includes(session.channel)
      || !['sessionId','principalId','partition','policyEpoch'].every(key=>typeof session[key]==='string'&&session[key].length>0&&session[key].length<=512)
      || !session.requestContext||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=clock()
      || (session.csrfToken!==undefined && (typeof session.csrfToken!=='string'||session.csrfToken.length<1||session.csrfToken.length>512)))throw denied();
    return Object.freeze({...session});
  };
  return Object.freeze({
    async bind(transport,channel){
      if(!['human','agent'].includes(channel))throw denied();
      const proof=await isolation(transport),session=await sessionFor(transport);
      if(session.channel!==channel)throw denied();
      return Object.freeze({session,
        async recheck(){
          if(session.expiresAt<=clock())throw denied();
          if(await isolation(transport)!==proof)throw unavailable();
          const current=await sessionFor(transport);
          if(identity(current)!==identity(session)||current.requestContext!==session.requestContext
            || current.csrfToken!==session.csrfToken)throw denied();
        }});
    }
  });
}
