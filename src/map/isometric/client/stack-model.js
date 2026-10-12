/** Pure multiscale model. Every segment is a source member; every pipe aggregates actual admitted edges. */
export const STACK_KINDS = Object.freeze({
  callable: { color: '#5dd9ca', shape: 'circle', label: 'Function / method' },
  type: { color: '#a99bf7', shape: 'square', label: 'Class / type' },
  value: { color: '#efb96e', shape: 'pyramid', label: 'Variable / field' },
  other: { color: '#aab8c9', shape: 'square', label: 'Other / unknown' }
});
export const segmentKind = member => {
  const kind=String(member.kind || member.type || '').toLowerCase();
  return /function|method|constructor|callable/.test(kind) ? 'callable' : /class|interface|struct|enum|type/.test(kind) ? 'type' : /variable|field|property|constant|binding/.test(kind) ? 'value' : 'other';
};
const compare = (a,b) => String(a).localeCompare(String(b),'en');
const id = value => value == null ? null : String(value);
export function buildStackModel(files, edges, {scale=1,groupDepth=1,maxFiles=500,maxMembers=12000,maxEdges=16000}={}) {
  maxFiles=Math.min(500,Math.max(0,Number.isFinite(maxFiles)?Math.floor(maxFiles):500));
  maxMembers=Math.min(12000,Math.max(0,Number.isFinite(maxMembers)?Math.floor(maxMembers):12000));
  maxEdges=Math.min(16000,Math.max(0,Number.isFinite(maxEdges)?Math.floor(maxEdges):16000));
  scale=Number.isFinite(scale)&&scale>0?Math.min(10,scale):1;
  const groups=new Map(), fileByPath=new Map(), memberById=new Map();
  let remaining=maxMembers, omittedMembers=files.slice(maxFiles).reduce((sum,file)=>sum+(file.members?.length||0),0);
  for(const node of files.slice(0,maxFiles).sort((a,b)=>compare(a.path||a.name,b.path||b.name))) {
    const key=node.path || node.name; if(!key)continue;
    const parts=key.replaceAll('\\','/').split('/');
    const group=parts.slice(0,Math.min(groupDepth,parts.length-1)).join('/') || '(root)';
    const sourceMembers=[...(node.members || [])].sort((a,b)=>(a.range?.startLine??Infinity)-(b.range?.startLine??Infinity) || compare(a.id??a.name,b.id??b.name));
    const admitted=sourceMembers.slice(0,Math.max(0,remaining));remaining-=admitted.length;omittedMembers+=sourceMembers.length-admitted.length;
    const columns=Math.max(1,Math.ceil(admitted.length/20));
    const file={key,node,group,width:(columns*3+1)*scale,depth:4*scale,height:0.35*scale,topY:0.35*scale,members:[],x:0,z:0};
    admitted.forEach((member,index)=>{
      const column=Math.floor(index/20), ordinal=index%20, kind=segmentKind(member), memberId=id(member.id);
      const segment={member,id:memberId,kind,shape:STACK_KINDS[kind].shape,color:STACK_KINDS[kind].color,
        x:(column-(columns-1)/2)*3*scale,y:(0.8+ordinal*0.8)*scale,z:0,width:2.5*scale,height:0.6*scale,depth:2.5*scale,ordinal:index};
      file.members.push(segment);if(memberId!==null)memberById.set(memberId,{file,segment});
    });
    file.stackHeight=Math.max(file.height,...file.members.map(row=>row.y+row.height/2));
    fileByPath.set(key,file);const bucket=groups.get(group)||{key:group,files:[],x:0,z:0};bucket.files.push(file);groups.set(group,bucket);
  }
  const ordered=[...groups.values()].sort((a,b)=>compare(a.key,b.key));
  for(const group of ordered){
    const columns=Math.max(1,Math.ceil(Math.sqrt(group.files.length))), cell=Math.max(7*scale,...group.files.map(file=>file.width+3*scale));
    group.width=columns*cell+3*scale;group.depth=Math.ceil(group.files.length/columns)*8*scale+3*scale;
    group.files.forEach((file,index)=>{file.x=(index%columns+0.5)*cell-group.width/2+1.5*scale;file.z=(Math.floor(index/columns)+0.5)*8*scale-group.depth/2+1.5*scale;});
  }
  const groupColumns=Math.max(1,Math.ceil(Math.sqrt(ordered.length))), groupCellX=Math.max(1,...ordered.map(row=>row.width))+8*scale,groupCellZ=Math.max(1,...ordered.map(row=>row.depth))+8*scale;
  ordered.forEach((group,index)=>{group.x=(index%groupColumns-(groupColumns-1)/2)*groupCellX;group.z=(Math.floor(index/groupColumns)-(Math.ceil(ordered.length/groupColumns)-1)/2)*groupCellZ;
    for(const file of group.files){file.x+=group.x;file.z+=group.z;}
  });
  const endpoint=ref=>{
    if(ref?.member!=null){const found=memberById.get(id(ref.member));if(!found)return null;
      // A supplied file and member must agree; never silently connect a mismatched endpoint.
      if(ref.file && ref.file!==found.file.key)return null;
      return {file:found.file,member:found.segment,anchor:{x:found.file.x+found.segment.x,y:found.segment.y,z:found.file.z+found.segment.z}};
    }
    const file=fileByPath.get(ref?.file);return file?{file,member:null,anchor:{x:file.x,y:file.topY,z:file.z}}:null;
  };
  const segments=[],filePipes=new Map(),groupPipes=new Map();let unresolved=0;
  const aggregate=(map,key,row)=>{const current=map.get(key);if(current){current.count++;current.evidence.push(row.evidence);}else map.set(key,{...row,count:1,evidence:[row.evidence]});};
  for(const evidence of edges.slice(0,maxEdges)){
    const from=endpoint(evidence.from),to=endpoint(evidence.to);if(!from||!to){unresolved++;continue;}
    const type=evidence.type || 'unknown';
    const row={from:from.anchor,to:to.anchor,type,fromFile:from.file.key,toFile:to.file.key,fromMember:from.member?.id??null,toMember:to.member?.id??null,evidence};segments.push({...row,count:1});
    const a={x:from.file.x,y:from.file.stackHeight+0.8*scale,z:from.file.z},b={x:to.file.x,y:to.file.stackHeight+0.8*scale,z:to.file.z};
    aggregate(filePipes,JSON.stringify([type,from.file.key,to.file.key]),{...row,from:a,to:b});
    if(from.file.group!==to.file.group){const ga=groups.get(from.file.group),gb=groups.get(to.file.group);
      aggregate(groupPipes,JSON.stringify([type,ga.key,gb.key]),{...row,fromGroup:ga.key,toGroup:gb.key,from:{x:ga.x,y:0,z:ga.z},to:{x:gb.x,y:0,z:gb.z}});}
  }
  const allFiles=[...fileByPath.values()];const minX=Math.min(0,...ordered.map(row=>row.x-row.width/2)),maxX=Math.max(0,...ordered.map(row=>row.x+row.width/2));
  const minZ=Math.min(0,...ordered.map(row=>row.z-row.depth/2)),maxZ=Math.max(0,...ordered.map(row=>row.z+row.depth/2));
  const maxHeight=Math.max(0,...allFiles.map(file=>file.stackHeight));
  return {groups:ordered,files:allFiles,fileByPath,memberById,levels:{segments,stacks:[...filePipes.values()],pipeline:[...groupPipes.values()]},
    coverage:{inputFiles:files.length,inputEdges:edges.length,unresolvedEdges:unresolved,omittedFiles:Math.max(0,files.length-allFiles.length),omittedMembers,omittedEdges:Math.max(0,edges.length-maxEdges),scope:'admitted display only'},
    bounds:{minX,maxX,minZ,maxZ,spanX:Math.max(40,maxX-minX),spanZ:Math.max(40,maxZ-minZ),maxSpan:Math.max(40,maxX-minX,maxZ-minZ,maxHeight*2),maxHeight}};
}
/** Screen-space size, not a magic raw zoom level. Manual tiers are stable under transient frame spikes. */
export function resolveStackTier({projectedFilePixels=0,mode='auto',previous=null}={}) {
  if(['pipeline','stacks','segments'].includes(mode))return mode;
  if(previous==='segments'&&projectedFilePixels>=70)return 'segments';
  if(previous==='pipeline'&&projectedFilePixels<34)return 'pipeline';
  return projectedFilePixels>=90?'segments':projectedFilePixels>=28?'stacks':'pipeline';
}
