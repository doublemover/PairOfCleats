/** Compatibility bridge: preserve original evidence objects while layout is worker-owned. */
export const hydrateSnapshotLayout = (model,source,plan) => {
  const planned=new Map(plan.nodes.map(file=>[file.path||file.name,file]));
  for(const file of model.files){
    const original=planned.get(file.key);if(!original)throw new Error('Worker layout returned a file outside its requested working set.');
    file.node=original;
    const allowed=new Set(original.members.filter(member=>member.id!=null).map(member=>JSON.stringify([typeof member.id,member.id])));
    for(const segment of file.members){
      const ordinal=segment.member.ordinal,member=source.files.get(file.key)?.members?.[ordinal];
      if(!member||segment.id!==String(member.id??null)||(member.id!=null&&!allowed.has(JSON.stringify([typeof member.id,member.id])))){
        // Null-ID legacy rows are render-only; their source ordinal remains an
        // address inside this pinned file, never a synthetic semantic identity.
        if(!(member&&member.id==null&&segment.id===null))throw new Error('Worker member layout disagrees with canonical source identity.');
      }
      segment.member=member;
    }
  }
  const evidence=row=>{const original=source.snapshot.edges[row.row];if(!original)throw new Error('Worker layout referenced unavailable relationship evidence.');return original;};
  for(const rows of Object.values(model.levels))for(const row of rows)row.evidence=Array.isArray(row.evidence)?row.evidence.map(evidence):evidence(row.evidence);
  return model;
};
