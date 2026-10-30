import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';

const commands = new Set(['include','add_subdirectory','find_package','target_link_libraries','add_dependencies']);
const scopes = new Set(['PRIVATE','PUBLIC','INTERFACE','LINK_PRIVATE','LINK_PUBLIC']);
const configurations = new Set(['debug','optimized','general']);
const bracket = (source,index) => {
  const open = source.slice(index).match(/^\[(=*)\[/);
  if (!open) return null;
  const close = `]${open[1]}]`, end = source.indexOf(close,index+open[0].length);
  return end < 0 ? null : {value:source.slice(index+open[0].length,end).replace(/^(?:\r\n|\n|\r)/u,''),end:end+close.length};
};
export const collectCmakeImports = (text,options = {}) => {
  const imports = new Set();
  const context = createCollectorBudgetContext({text,options,collectorId:'imports:cmake',
    defaults:{maxChars:524288,maxMatches:2048,maxTokens:4096,maxMs:30}});
  const source = context.source;
  const skipSpace = start => {
    let index = start;
    while (index < source.length) {
      if (/\s/u.test(source[index])) {index++;continue;}
      if (source[index] !== '#') break;
      const comment = bracket(source,index+1);
      if (comment) index = comment.end;
      else {while(index < source.length && !/[\r\n]/u.test(source[index])) index++;}
    }
    return index;
  };
  try {
    let index = 0;
    while ((index = skipSpace(index)) < source.length && !context.scanBudget.exhausted) {
      if (!context.scanBudget.consumeTime()) break;
      const name = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
      if (!name) {index++;continue;}
      index += name.length;
      let cursor = skipSpace(index);
      if (source[cursor] !== '(') continue;
      const args = []; let depth = 1, malformed = false;
      cursor++;
      while (cursor < source.length && depth) {
        if ((cursor & 127) === 0 && !context.scanBudget.consumeTime()) {malformed=true;break;}
        cursor = skipSpace(cursor);
        if (source[cursor] === ')') {depth--;cursor++;continue;}
        if (source[cursor] === '(') {depth++;cursor++;continue;}
        if (cursor >= source.length) break;
        const start = cursor;
        const literal = bracket(source,cursor);
        if (literal) {if(depth === 1) args.push({value:literal.value,kind:'bracket',start,end:literal.end,dynamic:false});cursor=literal.end;continue;}
        const quote = source[cursor] === '"';
        let value = '', closed = !quote, dynamic = false;
        if (quote) cursor++;
        while (cursor < source.length) {
          const char = source[cursor];
          if (quote && char === '"') {closed=true;cursor++;break;}
          if (!quote && /[\s()#]/u.test(char)) break;
          if (char === '\\' && cursor + 1 < source.length) {
            cursor++;
            if(source[cursor] === '\r' && source[cursor+1] === '\n') cursor+=2;
            else if(source[cursor] === '\n') cursor++;
            else {value+=({n:'\n',r:'\r',t:'\t'})[source[cursor]] ?? source[cursor];cursor++;}
            continue;
          }
          if (char === '$' && /^\$(?:[<{]|(?:ENV|CACHE)\{)/u.test(source.slice(cursor))) dynamic=true;
          value += char;cursor++;
        }
        if (!closed) {malformed=true;break;}
        if (depth === 1 && value) args.push({value,kind:quote ? 'quoted' : 'unquoted',start,end:cursor,dynamic});
      }
      index = cursor;
      if (malformed || depth) break;
      const command = name.toLowerCase();
      if (!commands.has(command) || !context.scanBudget.consumeMatch()) continue;
      const values = ['target_link_libraries','add_dependencies'].includes(command) ? args.slice(1) : args.slice(0,1);
      for (const token of values) {
        if (command === 'target_link_libraries' && (scopes.has(token.value) || configurations.has(token.value))) continue;
        if (token.dynamic) continue;
        addBudgetedCollectorImport(imports,token.value,context.scanBudget,{literal:true});
      }
    }
    return [...imports];
  } finally {context.finalize();}
};
