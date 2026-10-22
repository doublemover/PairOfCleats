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
  const pending=new Map();let disposed=false;
  return {capabilities,
    async transact(operation,request){
      if(disposed)throw new Error('Renderer boundary has retired.');
      const token={};pending.set(token,operation);let candidate=null,committed=false;
      try{
        operation.signal.throwIfAborted();candidate=await prepare(request,operation);
        if(disposed||!operation.current())return {committed:false,reason:'superseded'};
        commit(candidate,request,operation);committed=true;
        return {committed:true,stamp:operation.stamp};
      }finally{
        pending.delete(token);if(candidate&&!committed)retire(candidate);operation.finish();
      }
    },
    dispose(){disposed=true;for(const operation of pending.values())operation.cancel();}
  };
};
