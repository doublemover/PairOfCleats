import { addBudgetedCollectorImport, createCollectorBudgetContext, stripInlineCommentAware } from './utils.js';

const SCHEME_RELATIVE_URL_RX = /^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[/:]|$)/i;
const MAKEFILE_OPTION_TOKEN_RX = /^\/{1,2}[A-Z][A-Z0-9_-]*(?::|$)/;
const MAKEFILE_VARIABLE_TOKEN_RX = /\$\([^)]+\)/;
const MAKEFILE_SPECIAL_TARGETS = new Set([
  '.DEFAULT',
  '.DELETE_ON_ERROR',
  '.EXPORT_ALL_VARIABLES',
  '.FORCE',
  '.IGNORE',
  '.INTERMEDIATE',
  '.LOW_RESOLUTION_TIME',
  '.NOTPARALLEL',
  '.ONESHELL',
  '.PHONY',
  '.POSIX',
  '.PRECIOUS',
  '.SECONDARY',
  '.SECONDEXPANSION',
  '.SILENT',
  '.SUFFIXES',
  '.SYMBOLIC',
  '.WAIT'
]);

const normalizeToken = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const stripped = raw
    .replace(/^[\"']/, '')
    .replace(/[\"']$/, '')
    .replace(/[;,]+$/g, '');
  if (!stripped) return '';
  if (SCHEME_RELATIVE_URL_RX.test(stripped)) return `https:${stripped}`;
  return stripped;
};

const isMakefilePseudoDependencyToken = (token) => {
  if (!token) return true;
  if (token === '|' || token === '\\') return true;
  const upper = token.toUpperCase();
  if (MAKEFILE_SPECIAL_TARGETS.has(upper) || upper === '.OBJ') return true;
  if (MAKEFILE_OPTION_TOKEN_RX.test(token)) return true;
  if (MAKEFILE_VARIABLE_TOKEN_RX.test(token)) return true;
  return false;
};

const splitMakeWords = source => {
  const words = [];let word = '';
  for (let index = 0;index < source.length;index++) {
    const char = source[index];
    if (char === '\\' && index+1 < source.length) {word += source[++index];continue;}
    if (/\s/u.test(char)) {if(word) words.push(word);word='';}
    else word+=char;
  }
  if(word) words.push(word);return words;
};
export const collectMakefileImports = (text,options = {}) => {
  const imports = new Set();
  const context = createCollectorBudgetContext({text,options,collectorId:'imports:makefile',
    defaults:{maxChars:524288,maxLines:8192,maxMatches:2048,maxTokens:4096,maxMs:30}});
  let recipePrefix = '\t', pending = '', recipe = false;
  const add = value => {
    const token = normalizeToken(value);
    if (token && !isMakefilePseudoDependencyToken(token) && !/[=$%]/u.test(token))
      addBudgetedCollectorImport(imports,token,context.scanBudget,{literal:true});
  };
  try {
    for (const raw of context.source.split(/\r\n|\n|\r/u)) {
      if (!context.scanBudget.consumeLine() || !context.scanBudget.consumeTime()) break;
      if (!pending) recipe = raw.startsWith(recipePrefix);
      const continuation = /(?<!\\)(?:\\\\)*\\$/u.test(raw);
      pending += (pending ? ' ' : '') + (continuation ? raw.slice(0,-1) : raw);
      if(continuation) continue;
      const record = pending;pending='';
      if(recipe) continue;
      const line = stripInlineCommentAware(record,{markers:['#']}).trim();
      if(!line) continue;
      const prefix = line.match(/^\.RECIPEPREFIX\s*[:?+]?=\s*(.)?/u);
      if(prefix) {recipePrefix=prefix[1] || '\t';continue;}
      const include = line.match(/^(?:-?include|sinclude)\s+(.+)$/u);
      if(include) {
        const wildcard = include[1].match(/^\$\(wildcard\s+([^)]+)\)$/u);
        for(const part of splitMakeWords(wildcard?.[1] || include[1])) add(part);
        continue;
      }
      const rule = line.match(/^([^:=]+)::?\s*(.*)$/u);
      if(!rule || /\$|=/u.test(rule[1])) continue;
      let dependencies = rule[2];
      if(/^(?:(?:override|private|export)\s+)*[A-Za-z_][A-Za-z0-9_.-]*\s*[:+?!]?=/u.test(dependencies)) continue;
      let semicolon = -1;
      for(let i=0;i<dependencies.length;i++) {if(dependencies[i] === '\\') i++;else if(dependencies[i] === ';'){semicolon=i;break;}}
      if(semicolon>=0) dependencies=dependencies.slice(0,semicolon);
      if(!context.scanBudget.consumeMatch()) break;
      for(const part of splitMakeWords(dependencies)) add(part);
    }
    return [...imports];
  } finally {context.finalize();}
};