import { isLocalSourceHistoryService } from './service.js';
import { runHistoryCallback } from './bounded-callback.js';
import { parseHistoryOwnerPrivacyForm } from './owner-page.js';
const MAX_BODY=65536,MAX_OUTPUT=2*1024*1024;
const headers={
  'cache-control':'no-store',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'cross-origin-resource-policy':'same-origin','cross-origin-opener-policy':'same-origin'
};
const failure=(status,message)=>new Response(JSON.stringify({ok:false,message}),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
const pageRequest=url=>{
  if([...url.searchParams.keys()].some(key=>!['top','offset'].includes(key))
    || ['top','offset'].some(key=>url.searchParams.getAll(key).length>1))throw new TypeError();
  const result={};
  for(const [key,value]of url.searchParams){
    if(!/^\d+$/.test(value))throw new TypeError();
    result[key]=Number(value);
  }
  if((result.top!==undefined&&(!Number.isSafeInteger(result.top)||result.top<1||result.top>100))
    || (result.offset!==undefined&&(!Number.isSafeInteger(result.offset)||result.offset<0||result.offset>100000)))throw new TypeError();
  return result;
};
const formBody=async request=>{
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded')throw Object.assign(new Error(),{status:415});
  const declared=request.headers.get('content-length');
  if(declared!==null && (!/^\d+$/.test(declared)||Number(declared)>MAX_BODY))throw Object.assign(new Error(),{status:413});
  const reader=request.body?.getReader();let bytes=0;const chunks=[];
  const signal=AbortSignal.any([AbortSignal.timeout(5000),request.signal]);
  if(!reader)throw new TypeError();
  try{
    while(true){
      const {done,value}=await runHistoryCallback(()=>reader.read(),signal);if(done)break;
      bytes+=value.byteLength;if(bytes>MAX_BODY)throw Object.assign(new Error(),{status:413});
      chunks.push(value);
    }
  }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const body=Buffer.concat(chunks.map(value=>Buffer.from(value)));
  const text=new TextDecoder('utf-8',{fatal:true}).decode(body),fields=Object.create(null);
  for(const pair of text.split('&')){
    const position=pair.indexOf('=');
    const key=decodeURIComponent((position<0?pair:pair.slice(0,position)).replaceAll('+',' '));
    const value=decodeURIComponent((position<0?'':pair.slice(position+1)).replaceAll('+',' '));
    if(Object.hasOwn(fields,key))throw new TypeError();
    fields[key]=value;
  }
  return parseHistoryOwnerPrivacyForm(fields);
};
/** Fetch-compatible handler only: no socket, cookies, credential generation or session fallback. */
export function createHistoryOwnerHttpHandler({console:ownerConsole,boundary,origin}) {
  const allowed=new URL(origin);
  if(isLocalSourceHistoryService(ownerConsole)||allowed.origin!==origin||allowed.username||allowed.password
    || !(allowed.protocol==='https:' || allowed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(allowed.hostname))
    || typeof boundary?.bind!=='function'||!['page','audit','setPrivacy'].every(key=>typeof ownerConsole?.[key]==='function'))throw new TypeError('Explicit trusted owner origin/controller required.');
  return async function handle(request,transport){
    try{
      const url=new URL(request.url);
      if(url.origin!==origin||(request.headers.has('origin')&&request.headers.get('origin')!==origin))return failure(403,'Owner origin required.');
      const routes={'/owner/history':'page','/owner/history/audit':'audit','/owner/history/privacy':'privacy'};
      const route=routes[url.pathname];if(!route)return failure(404,'Unknown owner route.');
      const method=route==='privacy'?'POST':'GET';
      if(request.method!==method)return failure(405,'Method not allowed.');
      if(route==='privacy' && (url.search||request.headers.get('origin')!==origin))
        return failure(403,'Same-origin human mutation required.');
      const bound=await boundary.bind(transport,'human'),session=bound.session;
      const scope={requestContext:session.requestContext,partition:session.partition};
      let content,type;
      await bound.recheck();
      if(route==='privacy'){
        const fields=await formBody(request);
        if(fields.csrfToken!==session.csrfToken)return failure(403,'Bound human mutation token required.');
        await bound.recheck();
        content=JSON.stringify(await ownerConsole.setPrivacy({...scope,...fields}));type='application/json; charset=utf-8';
      }else{
        const paging=pageRequest(url);
        if(route==='audit'){content=JSON.stringify(await ownerConsole.audit({...scope,...paging}));type='application/json; charset=utf-8';}
        else{content=await ownerConsole.page({...scope,...paging},session.csrfToken?{privacyAction:'/owner/history/privacy',csrfToken:session.csrfToken}:{});
          type='text/html; charset=utf-8';}
      }
      await bound.recheck();
      if(Buffer.byteLength(content)>MAX_OUTPUT)return failure(413,'Owner response exceeds output budget.');
      return new Response(content,{status:200,headers:{...headers,'content-type':type}});
    }catch(error){
      const status=error?.status??({'ERR_INFERENCE_HISTORY_DENIED':403,'ERR_INFERENCE_HISTORY_UNAVAILABLE':503,
        'ERR_INFERENCE_HISTORY_STALE':409,'ERR_INFERENCE_HISTORY_AUDIT':503,'ERR_INFERENCE_HISTORY_LIMIT':413,
        'ERR_INFERENCE_HISTORY_INPUT':400}[error?.code]??400);
      return failure(status,'Owner request failed without releasing evidence.');
    }
  };
}
