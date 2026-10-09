const boundedInt=(value,min,max,label)=>{
  if(value==null)return null;
  const n=Number(value);
  if(!Number.isInteger(n)||n<min||n>max)throw new RangeError('Invalid '+label);
  return n;
};
export const resolveSearchControls=(argv={})=>{
  const preset=argv.preset || null;
  if(preset&&!['fast','hybrid','investigate'].includes(preset))throw new TypeError('Invalid --preset');
  const match=argv.match||'auto';
  if(!['all','any','auto'].includes(match))throw new TypeError('Invalid --match');
  return {preset,match,candidates:boundedInt(argv.candidates,1,100000,'--candidates'),deadlineMs:boundedInt(argv['deadline-ms'],1,600000,'--deadline-ms'),outputBytes:boundedInt(argv['output-bytes'],512,16777216,'--output-bytes')};
};
export const applyQueryMatchPolicy=(ast,policy='auto')=>{
  if(!ast||policy==='auto')return ast;
  const visit=node=>{
    if(!node)return node;
    const next={...node};
    if(next.type==='and'&&next.implicit===true){next.type=policy==='any'?'or':'and';next.implicit=false;}
    if(next.left)next.left=visit(next.left);
    if(next.right)next.right=visit(next.right);
    if(next.child)next.child=visit(next.child);
    return next;
  };
  return visit(ast);
};
