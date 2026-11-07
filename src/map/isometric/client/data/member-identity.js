/** Renderer maps store the original scalar source ID, never a slot or String(id). */
export const canonicalMemberId = (value,source=null) => {
  if(value==null)return null;
  const resolved=source?.resolve?.({type:'member',id:value});
  return resolved?.id??value;
};

/** Explicit adapter for legacy endpoint-key text at a pinned source boundary. */
export const lookupMemberIdentity = (map,value,source=null) => {
  if(value==null||!map)return undefined;
  const id=canonicalMemberId(value,source);
  return map.get(id)??map.get(String(id)); // Explicit compatibility with old String-key adapters.
};

/** Snapshot-local aliases preserve legacy numeric references without changing IDs. */
export const createMemberAliasIndex = () => {
  const byIdentity=new Map(),byText=new Map();
  return {
    set(id,value){
      byIdentity.set(id,value);const text=String(id);
      if(!byText.has(text))byText.set(text,new Map());byText.get(text).set(id,value);
    },
    get(id){
      if(id==null)return undefined;
      if(byIdentity.has(id))return byIdentity.get(id);
      const aliases=byText.get(String(id));return aliases?.size===1?aliases.values().next().value:undefined;
    },
    clear(){byIdentity.clear();byText.clear();}
  };
};
