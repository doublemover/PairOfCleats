import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { findCLikeBodyBounds } from './clike.js';
import {
  buildBraceDelimitedMethodRelations,
  buildDefaultDocMeta,
  extractDocComment,
  normalizeDeclarationList,
  sliceSignature
} from './shared.js';
import { readSignatureLines } from './shared/signature-lines.js';
import { buildHeuristicDataflow, hasReturnValue, summarizeControlFlow } from './flow.js';
import { buildTreeSitterChunks } from './tree-sitter.js';
import { readStaticShellWord } from './shared/shell-word.js';

/**
 * Shell (lite) language chunking and relations.
 * Focuses on function declarations with minimal metadata.
 */

export const SHELL_RESERVED_WORDS = new Set([
  'break',
  'case',
  'continue',
  'coproc',
  'declare',
  'do',
  'done',
  'elif',
  'else',
  'esac',
  'eval',
  'exec',
  'exit',
  'export',
  'false',
  'fi',
  'for',
  'function',
  'if',
  'in',
  'local',
  'readonly',
  'return',
  'select',
  'set',
  'shift',
  'source',
  'then',
  'time',
  'trap',
  'true',
  'typeset',
  'unset',
  'until',
  'wait',
  'while'
]);

const SHELL_CALL_KEYWORDS = new Set([
  ...SHELL_RESERVED_WORDS,
  'alias',
  'cd',
  'pwd',
  'test',
  'unalias'
]);

const SHELL_USAGE_SKIP = new Set([
  ...SHELL_CALL_KEYWORDS,
  'nil',
  'no',
  'null',
  'yes'
]);

const SHELL_DOC_OPTIONS = {
  linePrefixes: ['#'],
  blockStarts: [],
  blockEnd: null,
  skipLine: (line) => line.startsWith('#!')
};

const SHELL_CALLABLE_KINDS = new Set(['FunctionDeclaration']);

function stripShellComments(text) {
  return text.replace(/#.*$/gm, ' ');
}

function collectShellCallsAndUsages(text) {
  const calls = new Set();
  const usages = new Set();
  const heredocs=[];
  for(const line of String(text || '').replace(/\\\r?\n/g,'').split(/\r\n|\n|\r/u)) {
    if(heredocs.length) {
      const current=heredocs[0], candidate=current.stripTabs ? line.replace(/^\t+/,'') : line;
      if(candidate === current.delimiter) heredocs.shift();
      continue;
    }
    let command=true,index=0;
    while(index<line.length) {
      const char=line[index];
      if(/\s/u.test(char)) {index++;continue;}
      if(char === '#') break;
      if(';&|{}'.includes(char)) {command=true;index++;continue;}
      const redirection=line.slice(index).match(/^(?:\d+)?(<<-?|>>?|<)/u);
      if(redirection) {
        index+=redirection[0].length;
        const target=readStaticShellWord(line,index);
        if(!target) break;
        if(redirection[1].startsWith('<<')) heredocs.push({delimiter:target.value,stripTabs:redirection[1] === '<<-'});
        index=target.end;continue;
      }
      const word=readStaticShellWord(line,index);
      if(!word) {index++;command=false;continue;}
      index=word.end;
      if(command && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(word.value)) continue;
      if(command && ['if','then','elif','else','do','while','until','!'].includes(word.value)) continue;
      if(command && /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(word.value) && !SHELL_CALL_KEYWORDS.has(word.value)) calls.add(word.value);
      if(!SHELL_USAGE_SKIP.has(word.value) && /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(word.value)) usages.add(word.value);
      command=false;
    }
  }
  return { calls: Array.from(calls), usages: Array.from(usages) };
}

/**
 * Collect source/. imports from shell scripts.
 * @param {string} text
 * @returns {string[]}
 */
export function collectShellImports(text) {
  if (!text || (!text.includes('source') && !text.includes('. ') && !text.includes('.\t'))) return [];
  const imports = new Set();
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:source|\.)\s+(.+)$/);
    if (!match) continue;
    const target = readStaticShellWord(match[1])?.value;
    if (target) imports.add(target);
  }
  return Array.from(imports);
}

/**
 * Build chunk metadata for shell function declarations.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildShellChunks(text, options = {}) {
  const treeChunks = buildTreeSitterChunks({ text, languageId: 'shell', options });
  if (treeChunks && treeChunks.length) {
    const ext = String(options.ext || '').toLowerCase();
    return treeChunks.map(chunk => ({...chunk,meta:{...chunk.meta,shellSyntaxDialect:'bash',
      ...(['.zsh','.ksh'].includes(ext) ? { shellDialectCoverage:'unsupported-dialect-bash-syntax-subset',
        syntaxCallCoverage:'partial-bash-grammar-for-unsupported-shell-dialect' } : {})}}));
  }
  const lineIndex = buildLineIndex(text);
  const lines = text.split('\n');
  const decls = [];

  const funcKwRe = /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?/;
  const funcParenRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let match = trimmed.match(funcKwRe);
    if (!match) match = trimmed.match(funcParenRe);
    if (!match) continue;
    const sigData = readSignatureLines(lines, i, { stopOnSemicolon: false });
    const signature = sigData.signature;
    const endLine = sigData.endLine;
    const hasBody = sigData.hasBody;
    if (!hasBody) {
      i = endLine;
      continue;
    }
    if (!match) continue;
    const name = match[1];
    if (!name) {
      i = endLine;
      continue;
    }
    const start = lineIndex[i] + line.indexOf(trimmed);
    const bounds = hasBody ? findCLikeBodyBounds(text, start) : { bodyStart: -1, bodyEnd: -1 };
    const end = bounds.bodyEnd > start ? bounds.bodyEnd : lineIndex[endLine] + lines[endLine].length;
    const signatureText = bounds.bodyStart > start ? sliceSignature(text, start, bounds.bodyStart) : signature;
    const meta = {
      startLine: i + 1,
      endLine: offsetToLine(lineIndex, end),
      signature: signatureText || trimmed,
      docstring: extractDocComment(lines, i, SHELL_DOC_OPTIONS)
    };
    decls.push({ start, end, name, kind: 'FunctionDeclaration', meta });
    i = endLine;
  }

  return normalizeDeclarationList(decls);
}

/**
 * Build import/export/call/usage relations for shell chunks.
 * @param {string} text
 * @param {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null} shellChunks
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildShellRelations(text, shellChunks) {
  return buildBraceDelimitedMethodRelations(text, shellChunks, {
    collectImports: collectShellImports,
    collectCallsAndUsages: collectShellCallsAndUsages,
    findBodyBounds: findCLikeBodyBounds,
    callableKinds: SHELL_CALLABLE_KINDS,
    isExported: (chunk) => chunk.kind === 'FunctionDeclaration'
  });
}

/**
 * Normalize shell-specific doc metadata for search output.
 * @param {{meta?:Object}} chunk
 * @returns {{doc:string,params:string[],returns:(string|null),signature:(string|null)}}
 */
export function extractShellDocMeta(chunk) {
  return buildDefaultDocMeta(chunk, {
    params: [],
    returns: null
  });
}

/**
 * Heuristic control-flow/dataflow extraction for shell chunks.
 * @param {string} text
 * @param {{start:number,end:number}} chunk
 * @param {{dataflow?:boolean,controlFlow?:boolean}} [options]
 * @returns {{dataflow:(object|null),controlFlow:(object|null),throws:string[],awaits:string[],yields:boolean,returnsValue:boolean}|null}
 */
export function computeShellFlow(text, chunk, options = {}) {
  if (!chunk || !Number.isFinite(chunk.start) || !Number.isFinite(chunk.end)) return null;
  const bounds = findCLikeBodyBounds(text, chunk.start);
  const scanStart = bounds.bodyStart > -1 && bounds.bodyStart < chunk.end ? bounds.bodyStart + 1 : chunk.start;
  const scanEnd = bounds.bodyEnd > scanStart && bounds.bodyEnd <= chunk.end ? bounds.bodyEnd : chunk.end;
  if (scanEnd <= scanStart) return null;
  const slice = text.slice(scanStart, scanEnd);
  const cleaned = stripShellComments(slice).replace(/\\\n/g, ' ');
  const dataflowEnabled = options.dataflow !== false;
  const controlFlowEnabled = options.controlFlow !== false;
  const out = {
    dataflow: null,
    controlFlow: null,
    throws: [],
    awaits: [],
    yields: false,
    returnsValue: false
  };

  if (dataflowEnabled) {
    out.dataflow = buildHeuristicDataflow(cleaned, {
      skip: SHELL_USAGE_SKIP,
      identifierRegex: /\b([A-Za-z_][A-Za-z0-9_-]*)\b/g,
      memberOperators: []
    });
    out.returnsValue = hasReturnValue(cleaned);
    const throws = new Set();
    const exitRe = /\bexit\b/g;
    if (exitRe.test(cleaned)) throws.add('exit');
    out.throws = Array.from(throws);
  }

  if (controlFlowEnabled) {
    out.controlFlow = summarizeControlFlow(cleaned, {
      branchKeywords: ['if', 'then', 'elif', 'else', 'case'],
      loopKeywords: ['for', 'while', 'until', 'select'],
      returnKeywords: ['return']
    });
  }

  return out;
}
