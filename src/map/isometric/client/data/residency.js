const count=(value,fallback,maximum)=>Math.min(maximum,Math.max(0,Number.isFinite(value)?Math.floor(value):fallback));

/** Selects a bounded render working set; canonical source inventory is untouched. */
export const planSourceResidency = (index, selection, {current=[],files=60,membersPerFile=20,members=12000,edges=16000}={}) => {
  const selected=index.resolve(selection);
  if(!selected)throw new Error('Selected identity is unavailable in this pinned source snapshot.');
  const limits={files:count(files,60,500),members:count(members,12000,12000),membersPerFile:count(membersPerFile,20,12000),edges:count(edges,16000,16000)};
  if(!limits.files||(selected.type==='member'&&(!limits.members||!limits.membersPerFile)))throw new Error('Current render working-set budget cannot admit this selection. Increase its display/draw allowance to reveal it.');
  const requested=new Set(),ordered=[];
  const add=path=>{if(path&&!requested.has(path)&&index.files.has(path)&&ordered.length<limits.files){requested.add(path);ordered.push(path);}};
  add(selected.file);
  const directed=index.relationships(selected);
  for(const edge of directed){for(const endpoint of [edge.from,edge.to])add(endpoint?.file||(endpoint?.member!=null?index.fileByMember.get(String(endpoint.member)):null));if(ordered.length>=limits.files)break;}
  for(const file of current)add(typeof file==='string'?file:file.path||file.name);
  // The available inventory remains searchable even when this window is full.
  const selectedRow=index.files.get(selected.file);
  const selectedMembers=selectedRow.members||[];
  const selectedOrdinal=selected.type==='member'?selectedMembers.findIndex(member=>String(member.id)===String(selected.id)):0;
  if(selected.type==='member'&&selectedOrdinal<0)throw new Error('Selected member does not belong to its pinned source file.');
  let memberBudget=limits.members;
  let admittedMembers=0;
  const nodes=[];
  for(const path of ordered){
    const file=index.files.get(path),source=file.members||[];
    const size=Math.min(limits.membersPerFile,memberBudget),start=path===selected.file&&size>0?Math.floor(Math.max(0,selectedOrdinal)/size)*size:0;
    const page=source.slice(start,start+size);memberBudget-=page.length;
    admittedMembers+=page.length;
    nodes.push({...file,members:page,residency:{sourceMembers:source.length,memberStart:start,memberEnd:start+page.length}});
  }
  const keptEdges=[],seenEdges=new Set();
  const admit=edge=>{
    if(seenEdges.has(edge)||keptEdges.length>=limits.edges)return;
    const owner=endpoint=>endpoint?.file||(endpoint?.member!=null?index.fileByMember.get(String(endpoint.member)):null);
    if(!requested.has(owner(edge.from))||!requested.has(owner(edge.to)))return;
    seenEdges.add(edge);keptEdges.push(edge);
  };
  for(const edge of directed)admit(edge);
  for(const path of ordered){for(const edge of index.relationships({type:'file',file:path})){admit(edge);if(keptEdges.length>=limits.edges)break;}if(keptEdges.length>=limits.edges)break;}
  return {snapshot:index.snapshot,selected,nodes,edges:keptEdges,limits,
    coverage:{scope:'resident working set in available snapshot',available:index.counts,
      resident:{files:nodes.length,members:admittedMembers,edges:keptEdges.length},
      nonresident:{files:Math.max(0,index.counts.files-nodes.length),members:Math.max(0,index.counts.members-admittedMembers),edges:Math.max(0,index.counts.edges-keptEdges.length)},
      selectedMemberPage:selected.type==='member'?nodes[0].residency:null,
      sourceOmitted:index.snapshot.summary?.dropped||null,queryExpanded:false}};
};
