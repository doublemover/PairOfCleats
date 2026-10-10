const reference = type => type.startsWith('ref') || ['funcref','externref'].includes(type);
const mayMatch = (a,b) => ['params','results'].every(key => a[key].length === b[key].length && a[key].every((type,index) => type === b[key][index] || reference(type) && reference(b[key][index])));
const sameType = (a,b) => JSON.stringify([a.params,a.results]) === JSON.stringify([b.params,b.results]);
/** Exact slots only for module-owned, unexported, never-written tables with
 * statically initialized offsets. Other tables retain bounded may-target sets. */
export const createWasmTableTargets = module => {
  const imported = module.imports.filter(item=>item.kind===1);
  const tables = [...imported.map(item=>item.table),...module.tables].map((table,index)=>({ slots:new Map(),
    unknown:index<imported.length || module.exports.some(item=>item.kind===1&&item.index===index) || Boolean(table.initializer) }));
  for (const segment of module.elements) {
    if (segment.mode && segment.mode!=='active')continue;
    const table=tables[segment.tableIndex||0]; if(!table)continue;
    const offset=segment.offset?.length===2&&segment.offset[0].name==='i32.const'?segment.offset[0].value:null;
    if(offset==null||offset<0) { table.unknown=true; continue; }
    if (segment.expressions?.some(expr => expr.length !== 2 || !['ref.func','ref.null'].includes(expr[0].name))) table.unknown = true;
    const functions=segment.functions||segment.expressions.map(expr=>expr.length===2&&expr[0].name==='ref.func'?expr[0].index:null);
    functions.forEach((fn,index)=>table.slots.set(offset+index,fn));
  }
  for(const fn of module.functions)for(const item of fn.instructions)if(['table.set','table.grow','table.fill','table.init','table.copy'].includes(item.name)) {
    const table=tables[item.index??item.storageIndex??0]; if(table)table.unknown=true;
  }
  return (item, selector, functions) => {
    const table=tables[item.tableIndex||0], type=module.types[item.typeIndex];
    if(table&&!table.unknown) {
      const indexes=selector==null?[...new Set(table.slots.values())]:[table.slots.get(selector)];
      const targets = indexes.filter(index => index != null && mayMatch(functions[index].type,type));
      const uncertainTypes = targets.some(index => !sameType(functions[index].type,type));
      return { targets, exact:selector!=null && !uncertainTypes, unknown:uncertainTypes };
    }
    const targets=functions.filter(fn=>mayMatch(fn.type,type)).slice(0,256).map(fn=>fn.index);
    return { targets, exact:false, unknown:true };
  };
};
