const endpoint=(row,side)=>({file:row[`${side}File`]??null,member:row[`${side}Member`]??null,group:row[`${side}Group`]??null});

/** View grammar preserves source labels; it never upgrades confidence to proof. */
export const projectPipeSemantics = (row,level) => {
  const evidence=Array.isArray(row.evidence)?row.evidence:[row.evidence],labels=new Set();
  for(const source of evidence)labels.add(typeof source?.certainty==='string'&&source.certainty?source.certainty:'not provided');
  const certainty=labels.size===1?[...labels][0]:'mixed';
  const pattern=certainty==='exact-static'?'solid':certainty==='mixed'?'dash-dot':['modeled','heuristic','inferred'].includes(certainty)?'dash':'dot';
  const from=endpoint(row,'from'),to=endpoint(row,'to');
  return {viewKey:JSON.stringify([level,row.type,from,to,evidence.map(source=>source?.id??source?.edgeId??null)]),
    type:row.type||'unknown',from,to,count:row.count||evidence.length,certainty,certaintyLabels:[...labels],pattern,
    textCue:`${row.type||'unknown'} · ${certainty==='mixed'?'mixed certainty':certainty} · static directed relationship`,
    sourceEvidence:evidence};
};

/** Route addresses are stable within a committed layer, independent of filtering. */
export const pipeLane = (row,level,ordinal,{scale=1,maxHeight=0}={}) => {
  const from=JSON.stringify(endpoint(row,'from')),to=JSON.stringify(endpoint(row,'to'));
  const forward=from<=to,lane=ordinal%32;
  const separation=(2+lane*0.2)*scale;
  return {lane,railY:(level==='pipeline'?maxHeight+3*scale:Math.max(row.from.y,row.to.y)+1.5*scale)+lane*.1*scale,
    side:forward?Math.max(row.from.z,row.to.z)+separation:Math.min(row.from.z,row.to.z)-separation,
    selfOffset:(2+lane*.15)*scale};
};
