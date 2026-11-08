/** Passive lexical argument tokens; callers retain their existing source budget. */
export const tokenizeStaticArguments = (source, { shouldContinue = () => true, dialect = null } = {}) => {
  const tokens = [];
  const identifierPattern = /[\p{ID_Start}_.][\p{ID_Continue}_.]*/uy;
  const rawRPattern = /[rR]"(-*)([([{])/uy;
  let index = 0;
  while (index < source.length) {
    if (!shouldContinue()) return null;
    const start = index, char = source[index];
    if (/\s/u.test(char)) { index++; continue; }
    if (char === '#') { while (index < source.length && !/[\r\n]/u.test(source[index])) index++; continue; }
    if (dialect === 'r' && (char === 'r' || char === 'R')) {
      rawRPattern.lastIndex = index;
      const raw = rawRPattern.exec(source);
      if (raw) {
        const close = ({ '(': ')', '[': ']', '{': '}' })[raw[2]] + raw[1] + '"';
        index = rawRPattern.lastIndex;
        const contentStart = index;
        while (index < source.length && !source.startsWith(close, index)) {
          if ((index & 1023) === 0 && !shouldContinue()) return null;
          index++;
        }
        if (index === source.length) return null;
        const value = source.slice(contentStart, index);
        index += close.length;
        tokens.push({ kind: 'raw-string', value, start, end: index }); continue;
      }
    }
    if (char === '"' || char === "'" || char === '`') {
      const triple = dialect !== 'r' && char !== '`' && source.startsWith(char.repeat(3),index);
      const close = triple ? char.repeat(3) : char;
      index += close.length;
      let value = '', closed = false;
      while (index < source.length) {
        if ((index & 1023) === 0 && !shouldContinue()) return null;
        if (source.startsWith(close,index)) { index += close.length; closed = true; break; }
        if (source[index] === '\\' && index + 1 < source.length) {
          const escaped = source[++index];
          value += ({n:'\n',r:'\r',t:'\t'})[escaped] ?? escaped; index++;
        } else value += source[index++];
      }
      if (!closed) return null;
      tokens.push({kind:'string',value,start,end:index}); continue;
    }
    identifierPattern.lastIndex = index;
    const identifier = identifierPattern.exec(source);
    if (identifier) { index = identifierPattern.lastIndex; tokens.push({kind:'identifier',value:identifier[0],start,end:index}); continue; }
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

export function* scanStaticCalls(source, names, { shouldContinue = () => true, dialect = null, acceptCall = () => true } = {}) {
  const tokens = tokenizeStaticArguments(source, { shouldContinue, dialect });
  if (!tokens) return;
  const stack = [], closes = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    if (!shouldContinue()) return;
    if (tokens[index].kind !== 'punctuation') continue;
    if (tokens[index].value === '(') stack.push(index);
    else if (tokens[index].value === ')' && stack.length) closes.set(stack.pop(), index);
  }
  for (let index = 0; index < tokens.length; index++) {
    if (!shouldContinue()) return;
    if (tokens[index].kind !== 'identifier' || !names.has(tokens[index].value) || tokens[index+1]?.value !== '(') continue;
    if (!acceptCall(tokens, index)) continue;
    const end = closes.get(index + 1);
    if (end === undefined) continue;
    yield {name:tokens[index].value,args:tokens.slice(index+2,end)};
  }
}
