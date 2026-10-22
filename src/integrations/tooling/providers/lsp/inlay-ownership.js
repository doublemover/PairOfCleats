/** Conservative source-backed insertion roles; no chunk-wide type guessing. */
export const createInlayOwnership = ({text,targetRange,paramNames=[],nameRange=null}) => {
  if(typeof text !== 'string')return ()=>null;
  const start=targetRange?.start,end=Math.min(targetRange?.end ?? 0,start+16384);
  if(!Number.isSafeInteger(start) || start<0 || !Number.isSafeInteger(end) || end<start || end>text.length)return ()=>null;
  const anchor=nameRange && nameRange.start>=start && nameRange.end<=end && nameRange.end-nameRange.start<256 ? nameRange.end : start;
  let open=-1,close=-1,depth=0,quote=null,escaped=false,lineComment=false,blockComment=false;
  const commas=[];
  for(let index=anchor;index<end;index++) {
    const char=text[index],next=text[index+1];
    if(lineComment) {if(/[\r\n]/u.test(char))lineComment=false;continue;}
    if(blockComment) {if(char==='*'&&next==='/'){blockComment=false;index++;}continue;}
    if(quote) {if(escaped){escaped=false;continue;}if(char==='\\'){escaped=true;continue;}if(char===quote)quote=null;continue;}
    if(char==='/'&&next==='/'){lineComment=true;index++;continue;}
    if(char==='/'&&next==='*'){blockComment=true;index++;continue;}
    if(['"',"'",'`'].includes(char)){quote=char;continue;}
    if(open<0 && ['{',';', '='].includes(char))break;
    if(char==='('){if(open<0)open=index;depth++;}
    else if(char===')' && depth){if(--depth===0){close=index;break;}}
    else if(char===',' && depth===1)commas.push(index);
  }
  if(open<0 || close<0)return ()=>null;
  const boundaries=[open,...commas,close],parameters=[];
  for(let index=0;index<boundaries.length-1;index++) {
    const from=boundaries[index]+1,to=boundaries[index+1],segment=text.slice(from,to);
    const bindingHead=segment.split(/[:=]/u,1)[0];
    const direct=segment.match(/^\s*(?:\.\.\.)?([$_\p{ID_Start}][$_\p{ID_Continue}]*)\s*(?=[:=?]|$)/u)?.[1];
    const names=paramNames.length ? paramNames : direct ? [direct] : [];
    for(const name of names) {
      const escapedName=String(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const match=bindingHead.match(new RegExp(`(?<![$\\p{ID_Continue}])${escapedName}(?![$\\p{ID_Continue}])`,'u'));
      if(!match)continue;
      const nameEnd=from+match.index+match[0].length;
      parameters.push({name,end:nameEnd,limit:to});
    }
  }
  return offset=>{
    for(const parameter of parameters) if(offset>=parameter.end && offset<=parameter.limit
      && /^\s*$/u.test(text.slice(parameter.end,offset)))return {role:'parameter',name:parameter.name};
    if(offset>=close+1 && offset<end && /^\s*$/u.test(text.slice(close+1,offset)))return {role:'return'};
    return null;
  };
};
