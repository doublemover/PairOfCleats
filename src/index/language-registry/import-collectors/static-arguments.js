/** Passive lexical argument tokens; callers retain their existing source budget. */
export const tokenizeStaticArguments = source => {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const start = index, char = source[index];
    if (/\s/u.test(char)) { index++; continue; }
    if (char === '#') { while (index < source.length && !/[\r\n]/u.test(source[index])) index++; continue; }
    if (char === '"' || char === "'" || char === '`') {
      const triple = char !== '`' && source.startsWith(char.repeat(3),index);
      const close = triple ? char.repeat(3) : char;
      index += close.length;
      let value = '', closed = false;
      while (index < source.length) {
        if (source.startsWith(close,index)) { index += close.length; closed = true; break; }
        if (source[index] === '\\' && index + 1 < source.length) {
          const escaped = source[++index];
          value += ({n:'\n',r:'\r',t:'\t'})[escaped] ?? escaped; index++;
        } else value += source[index++];
      }
      if (!closed) return null;
      tokens.push({kind:'string',value,start,end:index}); continue;
    }
    const identifier = source.slice(index).match(/^[\p{ID_Start}_.][\p{ID_Continue}_.]*/u);
    if (identifier) { index += identifier[0].length; tokens.push({kind:'identifier',value:identifier[0],start,end:index}); continue; }
    tokens.push({kind:'punctuation',value:char,start,end:++index});
  }
  return tokens;
};

export const splitStaticArguments = tokens => {
  const args = []; let current = [], depth = 0;
  for (const token of tokens || []) {
    if (token.kind === 'punctuation') {
      if (['(', '[', '{'].includes(token.value)) depth++;
      else if ([')', ']', '}'].includes(token.value)) depth--;
      if (token.value === ',' && depth === 0) { args.push(current); current = []; continue; }
    }
    current.push(token);
  }
  if (current.length) args.push(current);
  return args;
};
export const staticKeywordArgument = (tokens,key) => {
  const arg = splitStaticArguments(tokens).find(parts=>parts[0]?.kind === 'identifier' && parts[0].value === key && parts[1]?.value === '=');
  return arg?.length === 3 && arg[2].kind === 'string' ? arg[2].value : null;
};

export const scanStaticCalls = (source,names) => {
  const tokens = tokenizeStaticArguments(source);
  if (!tokens) return [];
  const calls = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].kind !== 'identifier' || !names.has(tokens[index].value) || tokens[index+1]?.value !== '(') continue;
    let depth = 1, end = index + 2;
    for (; end < tokens.length && depth; end++) if (tokens[end].kind === 'punctuation') {
      if (tokens[end].value === '(') depth++;
      else if (tokens[end].value === ')') depth--;
    }
    if (depth) break;
    calls.push({name:tokens[index].value,args:tokens.slice(index+2,end-1)});
    index = end-1;
  }
  return calls;
};
