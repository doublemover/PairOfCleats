import { state } from './state.js';
import { inspectValue } from '../../workspace/inspect.js';
import { createSourceViewRequestOwner } from './data/view-request-owner.js';
import { captureSceneFailure } from './scene-failure-inspection.js';
const button=(text,callback,current)=>{const value=document.createElement('button');value.type='button';value.textContent=text;
  value.onclick=function(...args){args[0]?.stopPropagation?.();if(current()&&value.isConnected)return Reflect.apply(callback,this,args);};return value;};
const preview=value=>String(value??'unresolved').slice(0,160);
const captureView=(host)=>{
  const source=state.remoteSource,index=state.sourceIndex,request=source.request;
  if(typeof request!=='function')throw new TypeError('Source view requires its original snapshot requester.');
  return {request:(...args)=>Reflect.apply(request,source,args),current:()=>host.isConnected&&state.remoteSource===source&&state.sourceIndex===index};
};
const report=(primary,current,publish)=>{
  if(!current())return {ok:false,reason:'superseded',primaryError:primary};
  const captured=captureSceneFailure(primary);
  if(current()&&captured.name!=='AbortError')publish(captured.message);
  return {ok:false,primaryError:primary,inspectionErrors:captured.inspectionErrors};
};

/** Virtual pages replace their DOM; continuation never accumulates all members. */
export const renderRemoteMembers = (group,info,navigate) => {
  const host=document.createElement('section');group.append(host);let cursor=0,epoch=0;
  const view=captureView(host),current=()=>view.current()&&group.isConnected;
  if(!current())return;
  const buttonForView=(text,callback)=>button(text,callback,current);
  const createOwner=()=>createSourceViewRequestOwner({host,request:view.request,isCurrent:current});
  let owner=createOwner();
  const render=async()=>{
    if(!current())return;
    const own=++epoch;host.replaceChildren(document.createTextNode('Loading member page…'));
    try{
      const page=await owner.query('members',{fileRow:info.address.fileRow,cursor,limit:40});
      if(own!==epoch||!current())return;host.replaceChildren();
      for(const member of page.rows){const action=buttonForView(`${preview(member.name||member.id)} · ${member.kind||member.type||'unknown'}`,()=>navigate({...member,type:'member'}));action.disabled=member.id==null;host.append(action);}
      host.append(document.createTextNode(`${page.total?cursor+1:0}–${cursor+page.rows.length} of ${page.total} available members. `));
      if(cursor>0)host.append(buttonForView('Previous member page',()=>{cursor=Math.max(0,cursor-40);render();}));
      if(page.next!==null)host.append(buttonForView('Next member page',()=>{cursor=page.next;render();}));
    }catch(error){return report(error,()=>own===epoch&&current(),message=>host.replaceChildren(document.createTextNode(message),buttonForView('Retry member page',render)));}
  };
  group.addEventListener('toggle',()=>{
    if(!current())return;
    if(!group.open){epoch++;owner.dispose();return;}
    if(owner.retired){owner=createOwner();render();}
  });render();
};

export const renderRemoteSourceDetails = (host,info,{navigate,openSource}) => {
  const lifetimeHost=document.createElement('span');lifetimeHost.hidden=true;host.append(lifetimeHost);
  const view=captureView(lifetimeHost),current=view.current;
  if(!current())return;
  const buttonForView=(text,callback)=>button(text,callback,current);
  const owner=createSourceViewRequestOwner({host:lifetimeHost,request:view.request,isCurrent:current});
  if(state.config.openUriTemplate)host.append(buttonForView('Open inspected source',openSource));
  const reveal=state.revealSourceSelection;
  if(!state.selectionFocusAvailable&&typeof reveal==='function')host.append(buttonForView('Reveal in bounded render working set',()=>Reflect.apply(reveal,state,[info])));
  const all=document.createElement('details'),title=document.createElement('summary');title.textContent='Source fields · load on demand';all.append(title);host.append(all);
  let loaded=false,detailComplete=false,detailEpoch=0,detailOwner=null;const body=document.createElement('div');all.append(body);
  all.addEventListener('toggle',async()=>{
    if(!current())return;
    if(!all.open){detailEpoch++;detailOwner?.dispose();if(!detailComplete)loaded=false;return;}
    if(loaded)return;loaded=true;const own=++detailEpoch;body.textContent='Loading pinned source detail…';
    detailOwner=createSourceViewRequestOwner({host:body,request:view.request,isCurrent:current});
    try{const result=await detailOwner.query('detail',{entity:info});if(own===detailEpoch&&current()&&all.isConnected){body.replaceChildren(inspectValue(result.detail));detailComplete=true;}}
    catch(error){if(own===detailEpoch&&current()){loaded=false;return report(error,current,message=>{body.textContent=message;});}}
  });
  const status=document.createElement('p');status.textContent='Loading exact directed totals…';host.append(status);
  owner.query('adjacency-summary',{entity:info}).then(summary=>{if(current()&&status.isConnected)status.textContent=`${summary.incoming} incoming / ${summary.outgoing} outgoing · ${summary.total} distinct available relationships.`;},error=>report(error,()=>current()&&status.isConnected,message=>{status.textContent=`Relationship totals unavailable: ${message}`;}));
  const relationships=document.createElement('section');host.append(relationships);let cursor=0,epoch=0;
  const render=async()=>{
    if(!current())return;
    const own=++epoch;relationships.replaceChildren(document.createTextNode('Loading relationship page…'));
    try{
      const page=await owner.query('adjacency',{entity:info,cursor,limit:40});
      if(own!==epoch||!current()||!relationships.isConnected)return;relationships.replaceChildren();
      for(const row of page.rows){const edge=row.evidence;
        relationships.append(buttonForView(`${edge.type||'unknown'} · ${preview(edge.from?.member??edge.from?.file)} → ${preview(edge.to?.member??edge.to?.file)}`,()=>{
          const detail=document.createElement('section');detail.append(inspectValue(edge));
          for(const [label,endpoint]of [['source',row.endpoints?.from],['target',row.endpoints?.to]]){const action=buttonForView(`Inspect ${label}${endpoint?'':' · unresolved in available snapshot'}`,()=>navigate(endpoint));action.disabled=!endpoint;detail.append(action);}
          relationships.replaceChildren(detail,buttonForView('Back to relationship page',render));
        }));
      }
      relationships.append(document.createTextNode(`${page.total?cursor+1:0}–${cursor+page.rows.length} of ${page.total} available relationships. `));
      if(cursor>0)relationships.append(buttonForView('Previous relationship page',()=>{cursor=Math.max(0,cursor-40);render();}));
      if(page.next!==null)relationships.append(buttonForView('Next relationship page',()=>{cursor=page.next;render();}));
    }catch(error){return report(error,()=>own===epoch&&current()&&relationships.isConnected,message=>relationships.replaceChildren(document.createTextNode(message),buttonForView('Retry relationship page',render)));}
  };render();
};
