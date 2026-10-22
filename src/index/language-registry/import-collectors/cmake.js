import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';

const commands = new Set(['include','add_subdirectory','find_package','target_link_libraries','add_dependencies']);
const scopes = new Set(['private','public','interface','link_private','link_public']);
const bracket = (source,index) => {
  const open = source.slice(index).match(/^\[(=*)\[/);
  if (!open) return null;
  const close = `]${open[1]}]`, end = source.indexOf(close,index+open[0].length);
  return end < 0 ? null : {value:source.slice(index+open[0].length,end),end:end+close.length};
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
        const literal = bracket(source,cursor);
        if (literal) {if(depth === 1) args.push(literal.value);cursor=literal.end;continue;}
        const quote = source[cursor] === '"';
        let value = '', closed = !quote;
        if (quote) cursor++;
        while (cursor < source.length) {
          const char = source[cursor];
          if (quote && char === '"') {closed=true;cursor++;break;}
          if (!quote && /[\s()#]/u.test(char)) break;
          if (char === '\\' && cursor + 1 < source.length) {cursor++;if(source[cursor] !== '\n') value+=source[cursor];cursor++;continue;}
          value += char;cursor++;
        }
        if (!closed) {malformed=true;break;}
        if (depth === 1 && value) args.push(value);
      }
      index = cursor;
      if (malformed || depth) break;
      const command = name.toLowerCase();
      if (!commands.has(command) || !context.scanBudget.consumeMatch()) continue;
      const values = ['target_link_libraries','add_dependencies'].includes(command) ? args.slice(1) : args.slice(0,1);
      for (const value of values) {
        if (command === 'target_link_libraries' && scopes.has(value.toLowerCase())) continue;
        if (/\$[<{]/u.test(value)) continue;
        addBudgetedCollectorImport(imports,value,context.scanBudget,{literal:true});
      }
    }
    return [...imports];
  } finally {context.finalize();}
};
