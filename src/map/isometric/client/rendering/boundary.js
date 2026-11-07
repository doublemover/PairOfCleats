import { preserveSceneCleanupFailures } from '../scene-retirement.js';

export const RENDERER_BOUNDARY_VERSION = 1;

/** Runtime availability is separate from measured backend/default acceptance. */
export const rendererCapabilities = ({renderer=null,sourceOnly=false,packetPolicy=null}={}) => ({
  version:RENDERER_BOUNDARY_VERSION,
  backend:sourceOnly||!renderer?'source-only':'three-webgl2',
  sourceNavigation:true,semanticSelection:true,
  worldGeometry:Boolean(renderer)&&!sourceOnly,
  residentTransactions:Boolean(renderer)&&!sourceOnly,
  spatialDrawPackets:Boolean(renderer)&&!sourceOnly&&Boolean(packetPolicy),spatialDrawPacketCandidate:true,asynchronousGpuPicking:false,
  physicalPathCapture:false,selectiveBloom:false,
  measuredAcceptance:'not-qualified',modernBackendDecision:'pending'
});

export const createRendererBoundary = ({prepare,commit,retire,capabilities}) => {
  const pending=new Map();let disposed=false,lastFailure=null;
  const transactionFailure=(primary,cleanupErrors,hasPrimary,committed,operation,phase)=>{
    const failure=preserveSceneCleanupFailures(primary,cleanupErrors,{hasPrimary,forceAggregate:true});
    Object.defineProperties(failure,{
      rendererTransactionCommitted:{value:committed},rendererTransactionStamp:{value:operation.stamp},
      rendererTransactionPhase:{value:phase},rendererTransactionCleanupFailed:{value:cleanupErrors.length>0}
    });
    lastFailure=failure;return failure;
  };
  return {capabilities,
    get lastFailure(){return lastFailure;},
    async transact(operation,request){
      if(disposed)throw new Error('Renderer boundary has retired.');
      const token={};pending.set(token,operation);let candidate=null,committed=false,result,primary,hasPrimary=false,phase='prepare';
      const cleanupErrors=[];
      try{
        operation.signal.throwIfAborted();candidate=await prepare(request,operation);
        if(disposed||!operation.current())result={committed:false,reason:'superseded'};
        else{
          phase='commit';commit(candidate,request,operation);committed=true;
          result={committed:true,stamp:operation.stamp};
        }
      }catch(error){
        hasPrimary=true;primary=error;
        // The actual resident producer publishes this flag before callbacks.
        // A later callback failure cannot authorize retiring the live scene.
        try{if(candidate?.published===true)committed=true;}catch(cleanup){cleanupErrors.push(cleanup);}
      }
      try{if(candidate&&!committed)await retire(candidate);}catch(error){cleanupErrors.push(error);}
      try{await operation.finish();}catch(error){cleanupErrors.push(error);}
      pending.delete(token);
      if(hasPrimary||cleanupErrors.length)throw transactionFailure(primary,cleanupErrors,hasPrimary,committed,operation,phase);
      return result;
    },
    dispose(){
      disposed=true;const errors=[];
      for(const operation of pending.values())try{operation.cancel();}catch(error){errors.push(error);}
      if(errors.length){lastFailure=preserveSceneCleanupFailures(null,errors,{forceAggregate:true});throw lastFailure;}
    }
  };
};
