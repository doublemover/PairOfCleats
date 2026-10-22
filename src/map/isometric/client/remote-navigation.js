import { state } from './state.js';
import { inspectValue } from '../../workspace/inspect.js';
import { createSourceViewRequestOwner } from './data/view-request-owner.js';
const button=(text,callback)=>{const value=document.createElement('button');value.type='button';value.textContent=text;value.onclick=callback;return value;};
const preview=value=>String(value??'unresolved').slice(0,160);

/** Virtual pages replace their DOM; continuation never accumulates all members. */
export const renderRemoteMembers = (group,info,navigate) => {
  const host=document.createElement('section');group.append(host);let cursor=0,epoch=0;
  let owner=createSourceViewRequestOwner({host,request:state.remoteSource.request});
  const render=async()=>{
    const own=++epoch;host.replaceChildren(document.createTextNode('Loading member page…'));
    try{
      const page=await owner.query('members',{fileRow:info.address.fileRow,cursor,limit:40});
      if(own!==epoch||!group.isConnected)return;host.replaceChildren();
      for(const member of page.rows){const action=button(`${preview(member.name||member.id)} · ${member.kind||member.type||'unknown'}`,()=>navigate({...member,type:'member'}));action.disabled=member.id==null;host.append(action);}
      host.append(document.createTextNode(`${page.total?cursor+1:0}–${cursor+page.rows.length} of ${page.total} available members. `));
      if(cursor>0)host.append(button('Previous member page',()=>{cursor=Math.max(0,cursor-40);render();}));
      if(page.next!==null)host.append(button('Next member page',()=>{cursor=page.next;render();}));
    }catch(error){if(error.name!=='AbortError'&&own===epoch&&host.isConnected)host.replaceChildren(document.createTextNode(error.message),button('Retry member page',render));}
  };
  group.addEventListener('toggle',()=>{
    if(!group.open){epoch++;owner.dispose();return;}
    if(owner.retired){owner=createSourceViewRequestOwner({host,request:state.remoteSource.request});render();}
  });render();
};

export const renderRemoteSourceDetails = (host,info,{navigate,openSource}) => {
  const lifetimeHost=document.createElement('span');lifetimeHost.hidden=true;host.append(lifetimeHost);
  const owner=createSourceViewRequestOwner({host:lifetimeHost,request:state.remoteSource.request});
  if(state.config.openUriTemplate)host.append(button('Open inspected source',openSource));
  if(!state.selectionFocusAvailable&&state.revealSourceSelection)host.append(button('Reveal in bounded render working set',()=>state.revealSourceSelection(info)));
  const all=document.createElement('details'),title=document.createElement('summary');title.textContent='Source fields · load on demand';all.append(title);host.append(all);
  let loaded=false,detailComplete=false,detailEpoch=0,detailOwner=null;const body=document.createElement('div');all.append(body);
  all.addEventListener('toggle',async()=>{
    if(!all.open){detailEpoch++;detailOwner?.dispose();if(!detailComplete)loaded=false;return;}
    if(loaded)return;loaded=true;const own=++detailEpoch;body.textContent='Loading pinned source detail…';
    detailOwner=createSourceViewRequestOwner({host:body,request:state.remoteSource.request});
    try{const result=await detailOwner.query('detail',{entity:info});if(own===detailEpoch&&all.isConnected){body.replaceChildren(inspectValue(result.detail));detailComplete=true;}}
    catch(error){if(own===detailEpoch){if(error.name!=='AbortError')body.textContent=error.message;loaded=false;}}
  });
  const status=document.createElement('p');status.textContent='Loading exact directed totals…';host.append(status);
  owner.query('adjacency-summary',{entity:info}).then(summary=>{if(status.isConnected)status.textContent=`${summary.incoming} incoming / ${summary.outgoing} outgoing · ${summary.total} distinct available relationships.`;},error=>{if(error.name!=='AbortError'&&status.isConnected)status.textContent=`Relationship totals unavailable: ${error.message}`;});
  const relationships=document.createElement('section');host.append(relationships);let cursor=0,epoch=0;
  const render=async()=>{
    const own=++epoch;relationships.replaceChildren(document.createTextNode('Loading relationship page…'));
    try{
      const page=await owner.query('adjacency',{entity:info,cursor,limit:40});
      if(own!==epoch||!relationships.isConnected)return;relationships.replaceChildren();
      for(const row of page.rows){const edge=row.evidence;
        relationships.append(button(`${edge.type||'unknown'} · ${preview(edge.from?.member??edge.from?.file)} → ${preview(edge.to?.member??edge.to?.file)}`,()=>{
          const detail=document.createElement('section');detail.append(inspectValue(edge));
          for(const [label,endpoint]of [['source',row.endpoints?.from],['target',row.endpoints?.to]]){const action=button(`Inspect ${label}${endpoint?'':' · unresolved in available snapshot'}`,()=>navigate(endpoint));action.disabled=!endpoint;detail.append(action);}
          relationships.replaceChildren(detail,button('Back to relationship page',render));
        }));
      }
      relationships.append(document.createTextNode(`${page.total?cursor+1:0}–${cursor+page.rows.length} of ${page.total} available relationships. `));
      if(cursor>0)relationships.append(button('Previous relationship page',()=>{cursor=Math.max(0,cursor-40);render();}));
      if(page.next!==null)relationships.append(button('Next relationship page',()=>{cursor=page.next;render();}));
    }catch(error){if(error.name!=='AbortError'&&own===epoch&&relationships.isConnected)relationships.replaceChildren(document.createTextNode(error.message),button('Retry relationship page',render));}
  };render();
};
