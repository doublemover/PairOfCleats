import { digest, historyError } from './common.js';
import { runHistoryCallback } from './bounded-callback.js';
import { createLocalHistorySemanticAdapter } from './semantic-adapter.js';

const invalid=()=>historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid bounded local semantic index.');
const ref=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const key=row=>JSON.stringify([row.sourceRef,row.snapshotRef,row.span.start,row.span.end]);
const vectorFor=(value,dimensions)=>{
  if((!Array.isArray(value)&&!ArrayBuffer.isView(value))||value.length!==dimensions||!Array.from(value).every(Number.isFinite))throw invalid();
  const norm=Math.hypot(...value);
  if(!Number.isFinite(norm)||norm===0)throw invalid();
  return Array.from(value,item=>item/norm);
};
/** Explicitly supplied authorized projections and a host-vetted local encoder only. No reads or model loaders. */
export function createLocalHistorySemanticIndex({modelId,modelVersion,dimensions,encodeText,chunkChars=1000,overlapChars=200}) {
  if(![modelId,modelVersion].every(value=>typeof value==='string'&&value.length>0&&value.length<=200)
    || !Number.isSafeInteger(dimensions)||dimensions<1||dimensions>4096||typeof encodeText!=='function'
    || !Number.isSafeInteger(chunkChars)||chunkChars<80||chunkChars>4000
    || !Number.isSafeInteger(overlapChars)||overlapChars<0||overlapChars>=chunkChars)throw invalid();
  let state=null,refreshing=false;
  return Object.freeze({
    async refresh({documents,generationRef},{signal,reauthorize}={}) {
      if(refreshing)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Concurrent local index refresh is not allowed.');
      refreshing=true;try{
        if(!ref(generationRef)||!Array.isArray(documents)||documents.length>1000||typeof reauthorize!=='function')throw invalid();
        if(documents.some(row=>!ref(row?.sourceRef)||!ref(row?.snapshotRef)||typeof row?.text!=='string'||row.text.length>32768))throw invalid();
        documents=documents.map(({sourceRef,snapshotRef,text})=>Object.freeze({sourceRef,snapshotRef,text}));
        signal=AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])]);
        await reauthorize();signal.throwIfAborted();
        const previous=new Map((state?.entries??[]).map(row=>[key(row),row]));
        const seen=new Set(),entries=[];let bytes=0,encoded=0,reused=0;
        // Stable order and an atomic replacement: cancellation or revocation preserves the last complete index.
        for(const document of [...documents].sort((a,b)=>JSON.stringify([a.sourceRef,a.snapshotRef]).localeCompare(JSON.stringify([b.sourceRef,b.snapshotRef])))){
          if(!ref(document?.sourceRef)||!ref(document.snapshotRef)||typeof document.text!=='string'||document.text.length>32768)throw invalid();
          const identity=JSON.stringify([document.sourceRef,document.snapshotRef]);
          if(seen.has(identity))throw invalid();seen.add(identity);
          bytes+=Buffer.byteLength(document.text);
          if(bytes>16*1024*1024)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Local index text budget exceeded.');
          for(let start=0;start<document.text.length;){
            signal?.throwIfAborted();
            let end=Math.min(document.text.length,start+chunkChars);
            if(end<document.text.length && /[\uD800-\uDBFF]/.test(document.text[end-1]))end--;
            const text=document.text.slice(start,end),row={sourceRef:document.sourceRef,snapshotRef:document.snapshotRef,
              span:{start,end},contentHash:digest(text)};
            const old=previous.get(key(row));
            if(old?.contentHash===row.contentHash){row.vector=old.vector;reused++;}
            else{row.vector=vectorFor(await runHistoryCallback(()=>encodeText(text,{signal}),signal),dimensions);encoded++;}
            entries.push(row);
            if(entries.length>5000)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Local index span budget exceeded.');
            await reauthorize();signal?.throwIfAborted();
            if(end===document.text.length)break;
            start=Math.max(start+1,end-overlapChars);
            if(start>0 && /[\uDC00-\uDFFF]/.test(document.text[start]))start++;
          }
        }
        await reauthorize();signal?.throwIfAborted();
        const contentManifestHash=digest(JSON.stringify(entries.map(({vector:_privateVector,...row})=>row)));
        state={generationRef,entries,contentManifestHash};
        return {version:'history-local-index.v1',generationRef,documents:seen.size,spans:entries.length,encoded,reused,
          modelId,modelVersion,dimensions,chunkChars,overlapChars,
          contentManifestHash,
          storage:'memory_only',scope:'caller_supplied_authorized_projections',coverage:'supplied_projections_only'};
      }finally{refreshing=false;}
    },
    adapter() {
      if(!state)throw historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE','Local index not refreshed.');
      const captured=state;
      return createLocalHistorySemanticAdapter({modelId,modelVersion,dimensions,indexGenerationRef:captured.generationRef,contentManifestHash:captured.contentManifestHash,
        encodeQuery:async(query,options)=>vectorFor(await encodeText(query,options),dimensions),
        searchIndex:async(vector,{top,signal})=>{
          const normalized=vectorFor(vector,dimensions);const ranked=[];
          for(const row of captured.entries){
            signal?.throwIfAborted();
            let score=0;for(let index=0;index<dimensions;index++)score+=normalized[index]*row.vector[index];
            ranked.push({row,score});
          }
          ranked.sort((a,b)=>b.score-a.score||key(a.row).localeCompare(key(b.row)));
          const seen=new Set(),units=ranked.filter(({row})=>{const identity=JSON.stringify([row.sourceRef,row.snapshotRef]);if(seen.has(identity))return false;seen.add(identity);return true;});
          return {candidates:units.slice(0,top).map(({row})=>({sourceRef:row.sourceRef,snapshotRef:row.snapshotRef,span:{...row.span}})),
            complete:units.length<=top};
        }});
    }
  });
}
