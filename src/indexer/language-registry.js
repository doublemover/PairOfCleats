import {
  isCLike,
  isGo,
  isJava,
  isJsLike,
  isPerl,
  isShell,
  isTypeScript,
  isCSharp,
  isKotlin,
  isRuby,
  isPhp,
  isHtml,
  isCss,
  isLua,
  isSql
} from './constants.js';
import { buildCLikeChunks, buildCLikeRelations, collectCLikeImports, computeCLikeFlow, extractCLikeDocMeta } from '../lang/clike.js';
import { buildGoChunks, buildGoRelations, collectGoImports, computeGoFlow, extractGoDocMeta } from '../lang/go.js';
import { buildJavaChunks, buildJavaRelations, collectJavaImports, computeJavaFlow, extractJavaDocMeta } from '../lang/java.js';
import { buildCodeRelations, collectImports, extractDocMeta, parseJavaScriptAst } from '../lang/javascript.js';
import { buildTypeScriptChunks, buildTypeScriptRelations, collectTypeScriptImports, computeTypeScriptFlow, extractTypeScriptDocMeta } from '../lang/typescript.js';
import { buildCSharpChunks, buildCSharpRelations, collectCSharpImports, computeCSharpFlow, extractCSharpDocMeta } from '../lang/csharp.js';
import { buildKotlinChunks, buildKotlinRelations, collectKotlinImports, computeKotlinFlow, extractKotlinDocMeta } from '../lang/kotlin.js';
import { buildRubyChunks, buildRubyRelations, collectRubyImports, computeRubyFlow, extractRubyDocMeta } from '../lang/ruby.js';
import { buildPhpChunks, buildPhpRelations, collectPhpImports, computePhpFlow, extractPhpDocMeta } from '../lang/php.js';
import { buildHtmlChunks, buildHtmlRelations, collectHtmlImports, computeHtmlFlow, extractHtmlDocMeta, getHtmlMetadata } from '../lang/html.js';
import { buildCssChunks, buildCssRelations, collectCssImports, computeCssFlow, extractCssDocMeta } from '../lang/css.js';
import { buildLuaChunks, buildLuaRelations, collectLuaImports, computeLuaFlow, extractLuaDocMeta } from '../lang/lua.js';
import { buildSqlChunks, buildSqlRelations, collectSqlImports, computeSqlFlow, extractSqlDocMeta } from '../lang/sql.js';
import { buildPerlChunks, buildPerlRelations, collectPerlImports, computePerlFlow, extractPerlDocMeta } from '../lang/perl.js';
import { getPythonAst, collectPythonImports, buildPythonRelations, extractPythonDocMeta } from '../lang/python.js';
import { buildRustChunks, buildRustRelations, collectRustImports, computeRustFlow, extractRustDocMeta } from '../lang/rust.js';
import { buildSwiftChunks, buildSwiftRelations, collectSwiftImports, computeSwiftFlow, extractSwiftDocMeta } from '../lang/swift.js';
import { buildShellChunks, buildShellRelations, collectShellImports, computeShellFlow, extractShellDocMeta } from '../lang/shell.js';
import { summarizeControlFlow } from '../lang/flow.js';

const flowOptions = (options) => ({
  dataflow: options.astDataflowEnabled,
  controlFlow: options.controlFlowEnabled
});

const buildControlFlowOnly = (text, chunk, options, keywords) => {
  if (!options.controlFlowEnabled || !chunk) return null;
  const slice = text.slice(chunk.start, chunk.end);
  return {
    dataflow: null,
    controlFlow: summarizeControlFlow(slice, keywords),
    throws: [],
    awaits: [],
    yields: false,
    returnsValue: false
  };
};

const JS_CONTROL_FLOW = {
  branchKeywords: ['if', 'else', 'switch', 'case', 'catch', 'try'],
  loopKeywords: ['for', 'while', 'do']
};

const PY_CONTROL_FLOW = {
  branchKeywords: ['if', 'elif', 'else', 'try', 'except', 'finally', 'match', 'case'],
  loopKeywords: ['for', 'while']
};

const LANGUAGE_REGISTRY = [
  {
    id: 'javascript',
    match: (ext) => isJsLike(ext),
    collectImports: (text, options) => collectImports(text, options),
    prepare: ({ text, mode, ext, options }) => (mode === 'code'
      ? { jsAst: parseJavaScriptAst(text, { ...options, ext }) }
      : {}),
    buildRelations: ({ text, relPath, allImports, context, options, ext }) =>
      buildCodeRelations(text, relPath, allImports, {
        ...options,
        ext,
        ast: context?.jsAst,
        dataflow: options.astDataflowEnabled,
        controlFlow: options.controlFlowEnabled
      }),
    extractDocMeta: ({ text, chunk, fileRelations }) => extractDocMeta(text, chunk, fileRelations),
    flow: ({ text, chunk, options }) => buildControlFlowOnly(text, chunk, options, JS_CONTROL_FLOW),
    attachName: false
  },
  {
    id: 'typescript',
    match: (ext) => isTypeScript(ext),
    collectImports: (text, options) => collectTypeScriptImports(text, options),
    prepare: ({ text, mode, ext, relPath, options }) => (mode === 'code'
      ? { tsChunks: buildTypeScriptChunks(text, { ext, relPath, parser: options?.typescript?.parser }) }
      : {}),
    buildRelations: ({ text, allImports, context, options, ext }) =>
      buildTypeScriptRelations(text, allImports, context.tsChunks, { ...options, ext }),
    extractDocMeta: ({ chunk }) => extractTypeScriptDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeTypeScriptFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'python',
    match: (ext) => ext === '.py',
    collectImports: (text) => collectPythonImports(text).imports,
    prepare: async ({ text, mode, options }) => (mode === 'code'
      ? {
        pythonAst: await getPythonAst(text, options.log, {
          dataflow: options.astDataflowEnabled,
          controlFlow: options.controlFlowEnabled,
          pythonAst: options.pythonAst
        })
      }
      : {}),
    buildRelations: ({ text, allImports, context }) => buildPythonRelations(text, allImports, context.pythonAst),
    extractDocMeta: ({ chunk }) => extractPythonDocMeta(chunk),
    flow: ({ text, chunk, options }) => buildControlFlowOnly(text, chunk, options, PY_CONTROL_FLOW),
    attachName: true
  },
  {
    id: 'swift',
    match: (ext) => ext === '.swift',
    collectImports: (text) => collectSwiftImports(text).imports,
    prepare: ({ text, mode, options }) => (mode === 'code'
      ? { swiftChunks: buildSwiftChunks(text, options) }
      : {}),
    buildRelations: ({ text, allImports }) => buildSwiftRelations(text, allImports),
    extractDocMeta: ({ chunk }) => extractSwiftDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeSwiftFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'clike',
    match: (ext) => isCLike(ext),
    collectImports: (text) => collectCLikeImports(text),
    prepare: ({ text, mode, ext, options }) => (mode === 'code'
      ? { clikeChunks: buildCLikeChunks(text, ext, options) }
      : {}),
    buildRelations: ({ text, allImports, context }) => buildCLikeRelations(text, allImports, context.clikeChunks),
    extractDocMeta: ({ chunk }) => extractCLikeDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeCLikeFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'rust',
    match: (ext) => ext === '.rs',
    collectImports: (text) => collectRustImports(text),
    prepare: ({ text, mode, options }) => (mode === 'code'
      ? { rustChunks: buildRustChunks(text, options) }
      : {}),
    buildRelations: ({ text, allImports }) => buildRustRelations(text, allImports),
    extractDocMeta: ({ chunk }) => extractRustDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeRustFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'go',
    match: (ext) => isGo(ext),
    collectImports: (text) => collectGoImports(text),
    prepare: ({ text, mode, options }) => (mode === 'code'
      ? { goChunks: buildGoChunks(text, options) }
      : {}),
    buildRelations: ({ text, allImports, context }) => buildGoRelations(text, allImports, context.goChunks),
    extractDocMeta: ({ chunk }) => extractGoDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeGoFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'java',
    match: (ext) => isJava(ext),
    collectImports: (text) => collectJavaImports(text),
    prepare: ({ text, mode, options }) => (mode === 'code'
      ? { javaChunks: buildJavaChunks(text, options) }
      : {}),
    buildRelations: ({ text, allImports, context }) => buildJavaRelations(text, allImports, context.javaChunks),
    extractDocMeta: ({ chunk }) => extractJavaDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeJavaFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'csharp',
    match: (ext) => isCSharp(ext),
    collectImports: (text) => collectCSharpImports(text),
    prepare: ({ text, mode, options }) => (mode === 'code'
      ? { csharpChunks: buildCSharpChunks(text, options) }
      : {}),
    buildRelations: ({ text, allImports, context }) => buildCSharpRelations(text, allImports, context.csharpChunks),
    extractDocMeta: ({ chunk }) => extractCSharpDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeCSharpFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'kotlin',
    match: (ext) => isKotlin(ext),
    collectImports: (text) => collectKotlinImports(text),
    prepare: ({ text, mode, options }) => (mode === 'code'
      ? { kotlinChunks: buildKotlinChunks(text, options) }
      : {}),
    buildRelations: ({ text, allImports, context }) => buildKotlinRelations(text, allImports, context.kotlinChunks),
    extractDocMeta: ({ chunk }) => extractKotlinDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeKotlinFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'ruby',
    match: (ext) => isRuby(ext),
    collectImports: (text) => collectRubyImports(text),
    prepare: ({ text, mode }) => (mode === 'code' ? { rubyChunks: buildRubyChunks(text) } : {}),
    buildRelations: ({ text, allImports, context }) => buildRubyRelations(text, allImports, context.rubyChunks),
    extractDocMeta: ({ chunk }) => extractRubyDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeRubyFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'php',
    match: (ext) => isPhp(ext),
    collectImports: (text) => collectPhpImports(text),
    prepare: ({ text, mode }) => (mode === 'code' ? { phpChunks: buildPhpChunks(text) } : {}),
    buildRelations: ({ text, allImports, context }) => buildPhpRelations(text, allImports, context.phpChunks),
    extractDocMeta: ({ chunk }) => extractPhpDocMeta(chunk),
    flow: ({ text, chunk, options }) => computePhpFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'html',
    match: (ext) => isHtml(ext),
    collectImports: (text) => collectHtmlImports(text),
    prepare: ({ text, mode, options }) => (mode === 'code'
      ? {
        htmlChunks: buildHtmlChunks(text, options),
        htmlMeta: getHtmlMetadata(text)
      }
      : {}),
    buildRelations: ({ text, allImports, context }) =>
      buildHtmlRelations(text, allImports, context.htmlChunks, context.htmlMeta),
    extractDocMeta: ({ chunk, context }) => extractHtmlDocMeta(chunk, context?.htmlMeta),
    flow: () => computeHtmlFlow(),
    attachName: false
  },
  {
    id: 'css',
    match: (ext) => isCss(ext),
    collectImports: (text) => collectCssImports(text),
    prepare: ({ text, mode }) => (mode === 'code' ? { cssChunks: buildCssChunks(text) } : {}),
    buildRelations: ({ text, allImports }) => buildCssRelations(text, allImports),
    extractDocMeta: ({ chunk }) => extractCssDocMeta(chunk),
    flow: () => computeCssFlow(),
    attachName: false
  },
  {
    id: 'lua',
    match: (ext) => isLua(ext),
    collectImports: (text) => collectLuaImports(text),
    prepare: ({ text, mode }) => (mode === 'code' ? { luaChunks: buildLuaChunks(text) } : {}),
    buildRelations: ({ text, allImports, context }) => buildLuaRelations(text, allImports, context.luaChunks),
    extractDocMeta: ({ chunk }) => extractLuaDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeLuaFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'sql',
    match: (ext) => isSql(ext),
    collectImports: (text) => collectSqlImports(text),
    prepare: ({ text, mode, ext, options }) => (mode === 'code'
      ? { sqlChunks: buildSqlChunks(text, { dialect: options.resolveSqlDialect(ext) }) }
      : {}),
    buildRelations: ({ text, allImports, context, options, ext }) =>
      buildSqlRelations(text, allImports, context.sqlChunks, {
        dialect: options.resolveSqlDialect(ext),
        log: options.log
      }),
    extractDocMeta: ({ chunk }) => extractSqlDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeSqlFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'perl',
    match: (ext) => isPerl(ext),
    collectImports: (text) => collectPerlImports(text),
    prepare: ({ text, mode }) => (mode === 'code' ? { perlChunks: buildPerlChunks(text) } : {}),
    buildRelations: ({ text, allImports, context }) => buildPerlRelations(text, allImports, context.perlChunks),
    extractDocMeta: ({ chunk }) => extractPerlDocMeta(chunk),
    flow: ({ text, chunk, options }) => computePerlFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'shell',
    match: (ext) => isShell(ext),
    collectImports: (text) => collectShellImports(text),
    prepare: ({ text, mode }) => (mode === 'code' ? { shellChunks: buildShellChunks(text) } : {}),
    buildRelations: ({ text, allImports, context }) => buildShellRelations(text, allImports, context.shellChunks),
    extractDocMeta: ({ chunk }) => extractShellDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeShellFlow(text, chunk, flowOptions(options)),
    attachName: true
  }
];

export function getLanguageForFile(ext, relPath) {
  const normalized = relPath || '';
  return LANGUAGE_REGISTRY.find((lang) => lang.match(ext, normalized)) || null;
}

export function collectLanguageImports({ ext, relPath, text, mode, options }) {
  const lang = getLanguageForFile(ext, relPath);
  if (!lang || typeof lang.collectImports !== 'function') return [];
  const imports = lang.collectImports(text, { ext, relPath, mode, options });
  return Array.isArray(imports) ? imports : [];
}

export async function buildLanguageContext({ ext, relPath, mode, text, options }) {
  const lang = getLanguageForFile(ext, relPath);
  const context = lang && typeof lang.prepare === 'function'
    ? await lang.prepare({ ext, relPath, mode, text, options })
    : {};
  return { lang, context };
}

export function buildChunkRelations({ lang, chunk, fileRelations, callIndex = null }) {
  if (!fileRelations) return {};
  const output = {};
  if (chunk?.name) {
    const callsForChunk = callIndex?.callsByCaller
      ? (callIndex.callsByCaller.get(chunk.name) || [])
      : (Array.isArray(fileRelations.calls)
        ? fileRelations.calls.filter(([caller]) => caller && caller === chunk.name)
        : []);
    if (callsForChunk.length) output.calls = callsForChunk;
    const detailsForChunk = callIndex?.callDetailsByCaller
      ? (callIndex.callDetailsByCaller.get(chunk.name) || [])
      : (Array.isArray(fileRelations.callDetails)
        ? fileRelations.callDetails.filter((detail) => detail?.caller === chunk.name)
        : []);
    if (detailsForChunk.length) output.callDetails = detailsForChunk;
  }
  if (lang?.attachName && chunk?.name) output.name = chunk.name;
  return output;
}
