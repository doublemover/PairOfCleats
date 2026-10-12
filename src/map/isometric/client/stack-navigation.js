import { state } from './state.js';
import { setSelection, renderSelectionDetails } from './selection.js';
import { inspectValue } from '../../workspace/inspect.js';
import { STACK_KINDS } from './stack-model.js';
import { updateStackVisibility } from './stack-scene.js';
const makeButton=(label,callback)=>{const button=document.createElement('button');button.textContent=label;button.type='button';button.onclick=callback;return button;};
const entityKey=info=>info?.type==='member'?`member:${info.id}`:info?.file?`file:${info.file}`:null;
export function focusStack(info=null){
  if(!state.camera||!state.THREE)return;
  const model=state.stackModel,file=model?.fileByPath.get(info?.file),member=info?.type==='member'?model?.memberById.get(String(info.id)):null;
  const target=member?{x:member.file.x+member.segment.x,y:member.segment.y,z:member.file.z}:file?{x:file.x,y:file.stackHeight/2,z:file.z}:{x:0,y:(model?.bounds.maxHeight||0)/2,z:0};
  const span=member?Math.max(12*(state.scaleFactor||1),member.file.stackHeight):file?Math.max(file.width*2,file.stackHeight*1.6):state.bounds?.maxSpan||80;
  const distance=Math.max(60,state.bounds?.maxSpan*2||60),offset=new state.THREE.Vector3(0,0,distance).applyQuaternion(state.camera.quaternion);
  state.camera.position.set(target.x,target.y,target.z).add(offset);
  const viewport=state.getViewport?.()||{width:1200,height:800};
  const availableWidth=Math.max(0.35,(viewport.width-560)/viewport.width);
  const zoom=Math.min((state.camera.right-state.camera.left)*availableWidth/span,(state.camera.top-state.camera.bottom)/span);
  state.camera.zoom=Math.max(state.controls?.zoomMin||0.05,Math.min(state.controls?.zoomMax||80,zoom));state.camera.updateProjectionMatrix();state.lockIsometric?.();updateStackVisibility(true);
}
export function navigateStack(info){
  const ref=info.type==='member'?state.memberInstanceById?.get(String(info.id)):state.fileInstanceByKey?.get(info.file);
  if(ref)setSelection({object:ref.mesh,instanceId:ref.instanceId});
  else{state.selectedInfo=info;renderSelectionDetails(info);state.onSelectionChanged?.(info);}
  focusStack(info);
}
export function initStackNavigation(){
  const tree=document.getElementById('stack-tree'),filter=document.getElementById('stack-search'),back=document.getElementById('stack-back'),forward=document.getElementById('stack-forward');
  if(!tree)return;
  let history=[],at=-1,replaying=false;
  const renderTree=()=>{
    tree.replaceChildren();const query=filter.value.trim().toLowerCase();let admitted=0;
    for(const file of state.files||[]){
      const members=file.members||[],match=(file.path||file.name||'').toLowerCase().includes(query);
      const hits=members.filter(member=>`${member.name} ${member.kind||member.type} ${member.id}`.toLowerCase().includes(query));
      if(query&&!match&&!hits.length)continue;if(admitted++>=80){tree.append(document.createTextNode('80 stacks shown. Narrow your search for more.'));break;}
      const group=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${file.path||file.name} · ${members.length} segments`;group.append(summary);
      group.append(makeButton('Focus stack',()=>navigateStack({type:'file',file:file.path||file.name,name:file.name})));
      let loaded=false;const load=()=>{if(loaded)return;loaded=true;let offset=0;
        const rows=query&&!match?hits:members;const more=makeButton('More segments',append);
        function append(){more.remove();for(const member of rows.slice(offset,offset+40))group.append(makeButton(`${member.name||member.id} · ${member.kind||member.type||'unknown'}`,()=>navigateStack({type:'member',file:file.path||file.name,id:member.id,name:member.name,range:member.range})));offset+=40;if(offset<rows.length)group.append(more);}
        append();};
      group.addEventListener('toggle',()=>{if(group.open)load();});if(query){group.open=true;load();}tree.append(group);
    }
  };
  filter.oninput=renderTree;
  const sourceDetails=info=>{
    const file=state.nodeByPath?.get(info.file),source=info.type==='member'?(file?.members||[]).find(row=>String(row.id)===String(info.id)):file;
    if(source){const all=document.createElement('details'),title=document.createElement('summary');title.textContent='All source fields · lazy inspector';all.append(title);let loaded=false;all.addEventListener('toggle',()=>{if(all.open&&!loaded){loaded=true;all.append(inspectValue(source));}});state.dom.selectionBody.append(all);}
    const heading=document.createElement('h3');heading.textContent='Directed relationships · admitted scope';state.dom.selectionBody.append(heading);
    const touches=endpoint=>info.type==='member'?endpoint?.member!=null&&String(endpoint.member)===String(info.id):endpoint?.file===info.file||state.fileByMember?.get(endpoint?.member)===info.file;
    const rows=(state.edges||[]).filter(edge=>touches(edge.from)||touches(edge.to));let offset=0;const more=makeButton('More relationships',append);
    function append(){more.remove();for(const edge of rows.slice(offset,offset+40)){
      const out=touches(edge.from),other=out?edge.to:edge.from;
      state.dom.selectionBody.append(makeButton(`${out?'→':'←'} ${edge.type} · ${other?.member??other?.file??'unresolved'}`,()=>{
        const host=state.dom.selectionBody;host.replaceChildren(inspectValue(edge));
        for(const [label,endpoint] of [['Source',edge.from],['Target',edge.to]]){
          const file=endpoint?.file||state.fileByMember?.get(endpoint?.member);
          const available=endpoint?.member!=null?state.memberInstanceById?.has(String(endpoint.member)):state.fileInstanceByKey?.has(file);
          const action=makeButton(`Go to ${label.toLowerCase()}${available?'':' · outside drawn scope'}`,()=>navigateStack({type:endpoint.member!=null?'member':'file',file,id:endpoint.member}));action.disabled=!available;host.append(action);
        }
      }));
    }offset+=40;if(offset<rows.length)state.dom.selectionBody.append(more);}
    append();if(!rows.length)state.dom.selectionBody.append(document.createTextNode('No admitted relationship. This is not evidence of absence from the index.'));
  };
  state.onSelectionChanged=info=>{
    if(!info){document.getElementById('stack-breadcrumb').textContent='Select a stack or segment';updateStackVisibility(true);return;}const key=entityKey(info);if(!replaying&&key!==entityKey(history[at])){history=history.slice(0,at+1);history.push({...info});if(history.length>50)history.shift();at=history.length-1;}
    back.disabled=at<1;forward.disabled=at>=history.length-1;
    sourceDetails(info);const breadcrumb=document.getElementById('stack-breadcrumb');breadcrumb.textContent=`${info.file||'Unknown file'}${info.type==='member'?' / '+(info.name||info.id):''}`;
  };
  const replay=step=>{const next=at+step;if(next<0||next>=history.length)return;at=next;replaying=true;navigateStack(history[at]);replaying=false;};back.onclick=()=>replay(-1);forward.onclick=()=>replay(1);
  document.getElementById('stack-home').onclick=()=>focusStack();
  document.getElementById('stack-focus').onclick=()=>focusStack(state.selectedInfo);
  document.getElementById('stack-mode').onchange=event=>{state.stackMode=event.target.value;updateStackVisibility(true);};
  document.getElementById('stack-all-edges').onchange=event=>{state.stackAllConnections=event.target.checked;updateStackVisibility(true);};
  document.getElementById('stack-plumbing').onclick=()=>{
    const host=state.dom.selectionBody;host.replaceChildren();const tier=state.stackTier||'stacks',rows=state.stackModel?.levels[tier]||[];
    const heading=document.createElement('h3');heading.textContent=`${tier} dependency plumbing · admitted scope`;host.append(heading);
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
  const legend=document.getElementById('stack-legend');for(const value of Object.values(STACK_KINDS)){const item=document.createElement('span');item.textContent=`${value.shape==='circle'?'●':value.shape==='pyramid'?'▲':'■'} ${value.label}`;item.style.color=value.color;legend.append(item);}
  state.refreshStackNavigation=renderTree;renderTree();
}
