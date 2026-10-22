import { state } from './state.js';
import { setSelection, setSemanticSelection, openSelection } from './selection.js';
import { inspectValue } from '../../workspace/inspect.js';
import { STACK_KINDS } from './stack-model.js';
import { updateStackVisibility } from './stack-scene.js';
import { selectionEndpointMatcher, endpointFile } from './selection-endpoints.js';
import { fitOrthographicBounds, usableViewport, visibleWorldBounds } from './camera-fit.js';
import { renderRemoteMembers, renderRemoteSourceDetails } from './remote-navigation.js';
const makeButton=(label,callback)=>{const button=document.createElement('button');button.textContent=label;button.type='button';button.onclick=callback;return button;};
const entityKey=info=>info?.type==='member'?`member:${info.id}`:info?.file?`file:${info.file}`:null;
export function focusStack(info=null){
  state.cancelCameraMotion?.();
  if(!state.camera||!state.THREE)return;
  const model=state.stackModel,file=model?.fileByPath.get(info?.file),member=info?.type==='member'?model?.memberById.get(String(info.id)):null;
  if(info && !(info.type==='member'?member:file)) {
    state.selectionFocusAvailable=false;
    return;
  }
  const viewport=state.getViewport?.()||{width:1200,height:800};
  const app=state.dom.app.getBoundingClientRect(),obstacles=[];
  for(const id of ['stack-bar','stack-status','menu','hud']){const node=document.getElementById(id);if(!node||node.hidden)continue;const rect=node.getBoundingClientRect();if(rect.width&&rect.height)obstacles.push({left:rect.left-app.left,right:rect.right-app.left,top:rect.top-app.top,bottom:rect.bottom-app.top});}
  const {THREE}=state;
  let bounds;
  if(member){const row=member.segment,center=new THREE.Vector3(member.file.x+row.x,row.y,member.file.z+row.z),half=new THREE.Vector3(Math.max(row.width*1.5,2),Math.max(row.height*2,2),Math.max(row.depth*1.5,2));bounds=new THREE.Box3(center.clone().sub(half),center.clone().add(half));}
  else if(file)bounds=new THREE.Box3(new THREE.Vector3(file.x-file.width/2,0,file.z-file.depth/2),new THREE.Vector3(file.x+file.width/2,file.stackHeight+1.2*(state.scaleFactor||1),file.z+file.depth/2));
  else bounds=visibleWorldBounds({THREE,roots:[state.fileGroup,state.memberGroup,state.edgeGroup,state.labelGroup]});
  state.cameraZoomRange=fitOrthographicBounds({THREE,camera:state.camera,bounds,viewport,usable:usableViewport({...viewport,obstacles}),requestedMin:state.controls?.zoomMin,requestedMax:state.controls?.zoomMax});
  state.nearPlane=state.camera.near;state.farPlane=state.camera.far;state.lockIsometric?.();updateStackVisibility(true);state.invalidateRender?.();
}
export function navigateStack(info,prepared=false){
  if(state.remoteSource&&!prepared)return state.remoteSource.navigate(info,resolved=>navigateStack(resolved,true));
  const ref=info.type==='member'?state.memberInstanceById?.get(String(info.id)):state.fileInstanceByKey?.get(info.file);
  if(ref)setSelection({object:ref.mesh,instanceId:ref.instanceId});
  else setSemanticSelection(info);
  focusStack(info);
}
export function initStackNavigation(){
  if(state.sourceNavigationInitialized){state.refreshStackNavigation?.();return;}
  state.inspectSourceReference=navigateStack;
  const tree=document.getElementById('stack-tree'),filter=document.getElementById('stack-search'),back=document.getElementById('stack-back'),forward=document.getElementById('stack-forward');
  if(!tree)return;
  state.sourceNavigationInitialized=true;
  let history=[],at=-1,replaying=false,treeOffset=0,queryEpoch=0,searchController=null;
  const renderWorkerTree=async query=>{
    const epoch=++queryEpoch;searchController?.abort();searchController=new AbortController();
    try{
      const queryOwner=state.remoteSource||state.graphWorkerClient;
      const result=await queryOwner.request('search',{query,cursor:treeOffset,limit:80,entityType:query?null:'file',directory:state.remoteDirectory??null},
        {revision:epoch,signal:searchController.signal});
      if(epoch!==queryEpoch||(!state.remoteSource&&!state.graphWorkerReady))return;
      tree.replaceChildren();
      for(const info of result.rows){
        if(info.type==='member'){tree.append(makeButton(`${info.file} / ${info.name||info.id}`,()=>navigateStack(info)));continue;}
        const group=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${info.file} · ${info.memberCount} available segments`;group.append(summary);
        group.append(makeButton('Inspect / focus stack',()=>navigateStack(info)));
        let loaded=false;
        group.addEventListener('toggle',()=>{if(!group.open||loaded)return;loaded=true;
          if(state.remoteSource){renderRemoteMembers(group,info,navigateStack);return;}
          const members=state.sourceIndex.files.get(info.file)?.members||[];let offset=0;
          const more=makeButton('More segments',append);
          function append(){more.remove();for(const member of members.slice(offset,offset+40))group.append(makeButton(`${member.name||member.id} · ${member.kind||member.type||'unknown'}`,()=>navigateStack({type:'member',file:info.file,id:member.id,name:member.name,range:member.range})));offset+=40;if(offset<members.length)group.append(more);}
          append();});
        tree.append(group);
      }
      const pager=document.createElement('nav');pager.setAttribute('aria-label','Pinned worker query results');
      pager.append(document.createTextNode(`${result.total?treeOffset+1:0}–${treeOffset+result.rows.length} of ${result.total??'unknown'} matching available ${query?'entities':'files'}. `));
      if(treeOffset>0)pager.append(makeButton('Previous results',()=>{treeOffset=Math.max(0,treeOffset-80);renderTree();}));
      if(result.next!==null)pager.append(makeButton('Next results',()=>{treeOffset=result.next;renderTree();}));
      tree.append(pager);
    }catch(error){if(error.name!=='AbortError'&&epoch===queryEpoch){state.graphWorkerError=error.message;state.graphWorkerReady=false;
      if(state.remoteSource){tree.replaceChildren(document.createTextNode(error.message),makeButton('Retry source page',()=>renderTree()));const fallback=document.createElement('a');fallback.href='/map.compat.html';fallback.textContent='Open pinned compatibility viewer';tree.append(fallback);}
      else renderTree();}}
  };
  const renderTree=()=>{
    const query=filter.value.trim().toLowerCase();if(state.remoteSource||state.graphWorkerReady){renderWorkerTree(query);return;}
    queryEpoch++;searchController?.abort();tree.replaceChildren();let admitted=0;
    for(const file of state.sourceIndex?.files.values()||state.files||[]){
      const members=file.members||[],match=(file.path||file.name||'').toLowerCase().includes(query);
      const hits=query&&!match?members.filter(member=>`${member.name} ${member.kind||member.type} ${member.id}`.toLowerCase().includes(query)):[];
      if(query&&!match&&!hits.length)continue;const ordinal=admitted++;if(ordinal<treeOffset||ordinal>=treeOffset+80)continue;
      const group=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${file.path||file.name} · ${members.length} segments`;group.append(summary);
      group.append(makeButton('Focus stack',()=>navigateStack({type:'file',file:file.path||file.name,name:file.name})));
      let loaded=false;const load=()=>{if(loaded)return;loaded=true;let offset=0;
        const rows=query&&!match?hits:members;const more=makeButton('More segments',append);
        function append(){more.remove();for(const member of rows.slice(offset,offset+40))group.append(makeButton(`${member.name||member.id} · ${member.kind||member.type||'unknown'}`,()=>navigateStack({type:'member',file:file.path||file.name,id:member.id,name:member.name,range:member.range})));offset+=40;if(offset<rows.length)group.append(more);}
        append();};
      group.addEventListener('toggle',()=>{if(group.open)load();});if(query){group.open=true;load();}tree.append(group);
    }
    const pager=document.createElement('nav');pager.setAttribute('aria-label','Available snapshot files');
    pager.append(document.createTextNode(`${admitted?treeOffset+1:0}–${Math.min(treeOffset+80,admitted)} of ${admitted} matching available files. `));
    if(treeOffset>0)pager.append(makeButton('Previous files',()=>{treeOffset=Math.max(0,treeOffset-80);renderTree();}));
    if(treeOffset+80<admitted)pager.append(makeButton('Next files',()=>{treeOffset+=80;renderTree();}));
    tree.append(pager);
  };
  filter.oninput=()=>{treeOffset=0;state.remoteDirectory=null;renderTree();};
  const sourceDetails=info=>{
    if(state.remoteSource){renderRemoteSourceDetails(state.dom.selectionBody,info,{navigate:navigateStack,openSource:openSelection});return;}
    const file=state.sourceIndex?.files.get(info.file)||state.nodeByPath?.get(info.file),source=info.type==='member'?state.sourceIndex?.members.get(String(info.id))?.member||(file?.members||[]).find(row=>String(row.id)===String(info.id)):file;
    if(state.config.openUriTemplate)state.dom.selectionBody.append(makeButton('Open inspected source',openSelection));
    else if(state.config.sourceNavigation?.available===false)state.dom.selectionBody.append(document.createTextNode(state.config.sourceNavigation.reason));
    if(!state.selectionFocusAvailable&&state.revealSourceSelection)state.dom.selectionBody.append(makeButton('Reveal in bounded render working set',()=>state.revealSourceSelection(info)));
    if(source){const all=document.createElement('details'),title=document.createElement('summary');title.textContent='All source fields · lazy inspector';all.append(title);let loaded=false;all.addEventListener('toggle',()=>{if(all.open&&!loaded){loaded=true;all.append(inspectValue(source));}});state.dom.selectionBody.append(all);}
    const heading=document.createElement('h3');heading.textContent='Directed relationships · admitted scope';state.dom.selectionBody.append(heading);
    const touches=selectionEndpointMatcher(info,{fileByMember:state.sourceIndex?.fileByMember||state.fileByMember});
    const rows=state.sourceIndex?.relationships(info)||(state.edges||[]).filter(edge=>touches(edge.from)||touches(edge.to));let offset=0;const more=makeButton('More relationships',append);
    function append(){more.remove();for(const edge of rows.slice(offset,offset+40)){
      const out=touches(edge.from),other=out?edge.to:edge.from;
      state.dom.selectionBody.append(makeButton(`${out?'→':'←'} ${edge.type} · ${other?.member??other?.file??'unresolved'}`,()=>{
        const host=state.dom.selectionBody;host.replaceChildren(inspectValue(edge));
        for(const [label,endpoint] of [['Source',edge.from],['Target',edge.to]]){
          const file=endpointFile(endpoint,state.sourceIndex?.fileByMember||state.fileByMember);
          const candidate={type:endpoint.member!=null?'member':'file',file,id:endpoint.member};
          const available=Boolean(state.sourceIndex?.resolve(candidate));
          const action=makeButton(`Inspect ${label.toLowerCase()}${available?'':' · unavailable in saved payload'}`,()=>navigateStack(candidate));action.disabled=!available;host.append(action);
        }
      }));
    }offset+=40;if(offset<rows.length)state.dom.selectionBody.append(more);}
    append();if(!rows.length)state.dom.selectionBody.append(document.createTextNode('No admitted relationship. This is not evidence of absence from the index.'));
  };
  state.onSelectionChanged=info=>{
    if(!info){document.getElementById('stack-breadcrumb').textContent='Select a stack or segment';back.disabled=at<1;forward.disabled=at>=history.length-1;updateStackVisibility(true);return;}const key=entityKey(info);if(!replaying&&key!==entityKey(history[at]?.info)){history=history.slice(0,at+1);history.push({info:{...info},snapshot:state.sourceIndex?.snapshot});if(history.length>50)history.shift();at=history.length-1;}
    back.disabled=at<1;forward.disabled=at>=history.length-1;
    sourceDetails(info);const breadcrumb=document.getElementById('stack-breadcrumb');breadcrumb.textContent=`${info.file||'Unknown file'}${info.type==='member'?' / '+(info.name||info.id):''}${state.selectionFocusAvailable?'':' · outside drawn scope; source inspection available'}`;
    state.revealInspector?.();
  };
  const replay=step=>{
    const next=at+step;if(next<0||next>=history.length)return;const entry=history[next];
    const accept=info=>{at=next;replaying=true;try{navigateStack(info,true);}finally{replaying=false;}};
    if(entry.snapshot!==state.sourceIndex?.snapshot){setSemanticSelection(null);document.getElementById('stack-breadcrumb').textContent='Historical selection belongs to another saved snapshot.';return;}
    if(state.remoteSource)state.remoteSource.navigate(entry.info,accept);else accept(entry.info);
  };back.onclick=()=>replay(-1);forward.onclick=()=>replay(1);
  document.getElementById('stack-home').onclick=()=>{if(state.remoteSource){state.showSnapshotOverview?.();focusStack();}else focusStack();};
  document.getElementById('stack-focus').onclick=()=>focusStack(state.selectedInfo);
  document.getElementById('stack-mode').onchange=event=>{state.stackMode=event.target.value;updateStackVisibility(true);};
  document.getElementById('stack-all-edges').onchange=event=>{state.stackAllConnections=event.target.checked;updateStackVisibility(true);};
  document.getElementById('stack-plumbing').onclick=()=>{
    const host=state.dom.selectionBody;host.replaceChildren();const tier=state.stackTier||'stacks',rows=state.stackVisibleRows||[];
    const heading=document.createElement('h3');heading.textContent=`${tier} dependency plumbing · currently visible filters`;host.append(heading);
    let offset=0;const more=makeButton('More pipes',append);
    function append(){more.remove();for(const row of rows.slice(offset,offset+40)){
      host.append(makeButton(`${row.type} · ${row.fromGroup||row.fromFile} → ${row.toGroup||row.toFile} · ${row.count} source relations`,()=>{
        host.replaceChildren(inspectValue(row));
        if(tier==='pipeline')for(const [label,key] of [['source',row.fromGroup],['target',row.toGroup]])host.append(makeButton(`Find ${label} directory: ${key}`,()=>{filter.value=key==='(root)'?'':key+'/';renderTree();}));
        else for(const [label,file,member] of [['source',row.fromFile,row.fromMember],['target',row.toFile,row.toMember]])host.append(makeButton(`Go to ${label}`,()=>navigateStack({type:tier==='segments'&&member!=null?'member':'file',file,id:member})));
      }));
    }offset+=40;if(offset<rows.length)host.append(more);}
    append();if(!rows.length)host.append(document.createTextNode('No resolved pipes at this scale within the admitted data.'));
  };
  const legend=document.getElementById('stack-legend');for(const [kind,value] of Object.entries(STACK_KINDS)){const item=document.createElement('span');item.dataset.stackKind=kind;item.textContent=`${value.shape==='circle'?'●':value.shape==='pyramid'?'▲':'■'} ${value.label}`;item.style.color=value.color;legend.append(item);}
  state.refreshStackNavigation=renderTree;renderTree();
  state.openSnapshotAggregate=aggregate=>{state.remoteDirectory=aggregate.all?null:aggregate.directory;filter.value='';treeOffset=0;state.viewerShell?.choose('Explore');renderTree();};
  state.onSourceQueryReady=()=>{treeOffset=0;renderTree();};
  state.onSourceQueryFailure=()=>{treeOffset=0;renderTree();};
}
