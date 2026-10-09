import { historyError } from './common.js';
export const HISTORY_SEMANTIC_CHUNKER_VERSION='history-spans.v1';
export function normalizeHistoryVector(value,dimensions){
  if((!Array.isArray(value)&&!ArrayBuffer.isView(value))||value.length!==dimensions||!Array.from(value).every(Number.isFinite)){
    throw historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid semantic vector.');
  }
  const norm=Math.hypot(...value);
  if(!Number.isFinite(norm)||norm===0)throw historyError('ERR_INFERENCE_HISTORY_INPUT','Invalid semantic vector norm.');
  return Array.from(value,item=>item/norm);
}
export function* historySemanticSpans(text,chunkChars,overlapChars){
  let count=0;
  for(let start=0;start<text.length;){
    if(++count>5000)throw historyError('ERR_INFERENCE_HISTORY_LIMIT','Semantic unit span budget exceeded.');
    let end=Math.min(text.length,start+chunkChars);
    if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
    yield {start,end,text:text.slice(start,end)};
    if(end===text.length)break;
    start=Math.max(start+1,end-overlapChars);
    if(start>0&&/[\uDC00-\uDFFF]/.test(text[start]))start++;
  }
}
