import path from 'node:path';
import * as linguistLanguages from 'linguist-languages';
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
  isSql,
  CMAKE_EXTS,
  STARLARK_EXTS,
  NIX_EXTS,
  DART_EXTS,
  SCALA_EXTS,
  GROOVY_EXTS,
  R_EXTS,
  JULIA_EXTS,
  HANDLEBARS_EXTS,
  MUSTACHE_EXTS,
  JINJA_EXTS,
  RAZOR_EXTS
} from './constants.js';
import { buildCLikeChunks, buildCLikeRelations, collectCLikeImports, computeCLikeFlow, extractCLikeDocMeta } from '../lang/clike.js';
import { buildGoChunks, buildGoRelations, collectGoImports, computeGoFlow, extractGoDocMeta } from '../lang/go.js';
import { buildJavaChunks, buildJavaRelations, collectJavaImports, computeJavaFlow, extractJavaDocMeta } from '../lang/java.js';
import { buildCodeRelations, collectImports, extractDocMeta, parseJavaScriptAst } from '../lang/javascript.js';
import { buildTypeScriptChunks, buildTypeScriptRelations, collectTypeScriptImports, computeTypeScriptFlow, extractTypeScriptDocMeta } from '../lang/typescript.js';
import { buildCSharpChunks, buildCSharpRelations, collectCSharpImports, computeCSharpFlow, extractCSharpDocMeta } from '../lang/csharp.js';
import * as kotlinLang from '../lang/kotlin.js';
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
import { buildTreeSitterChunksAsync } from '../lang/tree-sitter.js';

const {
  buildKotlinChunks,
  buildKotlinRelations,
  collectKotlinImports,
  computeKotlinFlow,
  extractKotlinDocMeta,
  getKotlinFileStats
} = kotlinLang;

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

const normalizeImportToken = (raw) => {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^[\"']/, '')
    .replace(/[\"']$/, '')
    .replace(/[);]+$/g, '');
};

const buildSimpleRelations = (imports, allImports) => {
  const list = Array.isArray(imports) ? imports.filter(Boolean) : [];
  const unique = Array.from(new Set(list));
  const importLinks = unique
    .map((entry) => allImports?.[entry])
    .filter((entry) => !!entry)
    .flat();
  return {
    imports: unique,
    exports: [],
    calls: [],
    usages: [],
    importLinks
  };
};

const collectDockerfileImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const fromMatch = line.match(/^\s*FROM\s+([^\s]+)(?:\s+AS\s+[^\s]+)?/i);
    if (fromMatch) imports.push(fromMatch[1]);
    const copyMatch = line.match(/^\s*COPY\s+--from=([^\s]+)\s+/i);
    if (copyMatch) imports.push(copyMatch[1]);
  }
  return imports;
};

const collectMakefileImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, '').trim();
    const match = trimmed.match(/^\s*-?include\s+(.+)$/i);
    if (!match) continue;
    const parts = match[1].split(/\s+/).filter(Boolean);
    imports.push(...parts);
  }
  return imports;
};

const collectProtoImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*import\s+(?:public\s+)?\"([^\"]+)\"/);
    if (match) imports.push(match[1]);
  }
  return imports;
};

const collectGraphqlImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*#import\s+\"([^\"]+)\"/i);
    if (match) imports.push(match[1]);
  }
  return imports;
};

const collectCmakeImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*(include|add_subdirectory|find_package)\s*\(\s*([^)]+)\)/i);
    if (!match) continue;
    const arg = match[2].trim().split(/\s+/)[0];
    const cleaned = normalizeImportToken(arg);
    if (cleaned) imports.push(cleaned);
  }
  return imports;
};

const collectStarlarkImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*load\s*\(\s*['\"]([^'\"]+)['\"]/);
    if (match) imports.push(match[1]);
  }
  return imports;
};

const collectNixImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/\b(import|callPackage)\s+([^\s;]+)/);
    if (!match) continue;
    const cleaned = normalizeImportToken(match[2]);
    if (cleaned) imports.push(cleaned);
  }
  return imports;
};

const collectDartImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(import|export)\s+['\"]([^'\"]+)['\"]/);
    if (match) imports.push(match[2]);
  }
  return imports;
};

const collectScalaImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*import\s+([^\s;]+)/);
    if (match) imports.push(match[1]);
  }
  return imports;
};

const collectGroovyImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*import\s+([^\s;]+)/);
    if (match) imports.push(match[1]);
  }
  return imports;
};

const collectRImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(library|require|source)\s*\(\s*['\"]?([^'\")]+)\s*/);
    if (match) imports.push(match[2]);
  }
  return imports;
};

const collectJuliaImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*(using|import|include)\s+([^\s;]+)/);
    if (!match) continue;
    const cleaned = normalizeImportToken(match[2]);
    if (cleaned) imports.push(cleaned);
  }
  return imports;
};

const collectHandlebarsImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/{{>\s*['\"]?([^\"'\s}]+)\b/);
    if (match) imports.push(match[1]);
  }
  return imports;
};

const collectMustacheImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/{{>\s*['\"]?([^\"'\s}]+)\b/);
    if (match) imports.push(match[1]);
  }
  return imports;
};

const collectJinjaImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/{%\s*(include|extends|import)\s+['\"]([^'\"]+)['\"]/);
    if (match) imports.push(match[2]);
  }
  return imports;
};

const collectRazorImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*@(?:using|addTagHelper|inherits)\s+([^\s]+)/);
    if (match) imports.push(match[1]);
  }
  return imports;
};

const LANGUAGE_REGISTRY = [
  {
    id: 'javascript',
    match: (ext) => isJsLike(ext),
    collectImports: (text, options) => collectImports(text, options),
    prepare: async ({ text, mode, ext, options }) => {
      if (mode !== 'code') return {};
      const context = {};
      const treeChunks = await buildTreeSitterChunksAsync({
        text,
        languageId: null,
        ext,
        options
      });
      if (treeChunks && treeChunks.length) context.jsChunks = treeChunks;
      if (options?.relationsEnabled !== false) {
        context.jsAst = parseJavaScriptAst(text, { ...options, ext });
      }
      return context;
    },
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
    prepare: async ({ text, mode, ext, relPath, options }) => {
      if (mode !== 'code') return {};
      if (options?.typescript?.importsOnly === true) return {};
      let tsChunks = await buildTreeSitterChunksAsync({
        text,
        languageId: ext === '.tsx' ? 'tsx' : 'typescript',
        ext,
        options
      });
      if (!tsChunks || !tsChunks.length) {
        tsChunks = buildTypeScriptChunks(text, { ext, relPath, parser: options?.typescript?.parser });
      }
      return { tsChunks };
    },
    buildRelations: ({ text, allImports, context, options, ext }) => {
      if (options?.typescript?.importsOnly === true) {
        const imports = collectTypeScriptImports(text, { ...options, ext });
        const importLinks = imports
          .map((entry) => allImports[entry])
          .filter((entry) => !!entry)
          .flat();
        return {
          imports,
          exports: [],
          calls: [],
          usages: [],
          importLinks
        };
      }
      return buildTypeScriptRelations(text, allImports, context.tsChunks, { ...options, ext });
    },
    extractDocMeta: ({ chunk }) => extractTypeScriptDocMeta(chunk),
    flow: ({ text, chunk, options }) => (options?.typescript?.importsOnly === true
      ? null
      : computeTypeScriptFlow(text, chunk, flowOptions(options))),
    attachName: true
  },
  {
    id: 'python',
    match: (ext) => ext === '.py',
    collectImports: (text) => collectPythonImports(text).imports,
    prepare: async ({ text, mode, options }) => {
      if (mode !== 'code') return {};
      let pythonAst = null;
      if (options?.relationsEnabled !== false) {
        pythonAst = await getPythonAst(text, options.log, {
          dataflow: options.astDataflowEnabled,
          controlFlow: options.controlFlowEnabled,
          pythonAst: options.pythonAst
        });
      }
      let pythonTreeChunks = null;
      if (!pythonAst) {
        pythonTreeChunks = await buildTreeSitterChunksAsync({
          text,
          languageId: 'python',
          ext: '.py',
          options
        });
      }
      return {
        ...(pythonAst ? { pythonAst } : {}),
        ...(pythonTreeChunks && pythonTreeChunks.length ? { pythonTreeChunks } : {})
      };
    },
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
      ? {
        kotlinChunks: buildKotlinChunks(text, options),
        kotlinStats: getKotlinFileStats(text)
      }
      : {}),
    buildRelations: ({ text, allImports, context, options }) => buildKotlinRelations(
      text,
      allImports,
      context.kotlinChunks,
      { stats: context.kotlinStats, kotlin: options.kotlin }
    ),
    extractDocMeta: ({ chunk }) => extractKotlinDocMeta(chunk),
    flow: ({ text, chunk, options, context }) => computeKotlinFlow(text, chunk, {
      ...flowOptions(options),
      kotlin: options.kotlin,
      stats: context.kotlinStats
    }),
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
    id: 'dockerfile',
    match: (ext) => ext === '.dockerfile',
    collectImports: (text) => collectDockerfileImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectDockerfileImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'makefile',
    match: (ext) => ext === '.makefile',
    collectImports: (text) => collectMakefileImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectMakefileImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'protobuf',
    match: (ext) => ext === '.proto',
    collectImports: (text) => collectProtoImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectProtoImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'graphql',
    match: (ext) => ext === '.graphql' || ext === '.gql',
    collectImports: (text) => collectGraphqlImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectGraphqlImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'cmake',
    match: (ext) => CMAKE_EXTS.has(ext),
    collectImports: (text) => collectCmakeImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectCmakeImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'starlark',
    match: (ext) => STARLARK_EXTS.has(ext),
    collectImports: (text) => collectStarlarkImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectStarlarkImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'nix',
    match: (ext) => NIX_EXTS.has(ext),
    collectImports: (text) => collectNixImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectNixImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'dart',
    match: (ext) => DART_EXTS.has(ext),
    collectImports: (text) => collectDartImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectDartImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'scala',
    match: (ext) => SCALA_EXTS.has(ext),
    collectImports: (text) => collectScalaImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectScalaImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'groovy',
    match: (ext) => GROOVY_EXTS.has(ext),
    collectImports: (text) => collectGroovyImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectGroovyImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'r',
    match: (ext) => R_EXTS.has(ext),
    collectImports: (text) => collectRImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectRImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'julia',
    match: (ext) => JULIA_EXTS.has(ext),
    collectImports: (text) => collectJuliaImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectJuliaImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'handlebars',
    match: (ext) => HANDLEBARS_EXTS.has(ext),
    collectImports: (text) => collectHandlebarsImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectHandlebarsImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'mustache',
    match: (ext) => MUSTACHE_EXTS.has(ext),
    collectImports: (text) => collectMustacheImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectMustacheImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'jinja',
    match: (ext) => JINJA_EXTS.has(ext),
    collectImports: (text) => collectJinjaImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectJinjaImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
    attachName: true
  },
  {
    id: 'razor',
    match: (ext) => RAZOR_EXTS.has(ext),
    collectImports: (text) => collectRazorImports(text),
    buildRelations: ({ text, allImports }) =>
      buildSimpleRelations(collectRazorImports(text), allImports),
    extractDocMeta: () => ({}),
    flow: () => null,
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

const LANGUAGE_BY_ID = new Map(LANGUAGE_REGISTRY.map((lang) => [lang.id, lang]));
const normalizeLinguistName = (value) => String(value || '').trim().toLowerCase();
const LINGUIST_NAME_TO_ID = new Map([
  ['c', 'clike'],
  ['c++', 'clike'],
  ['objective-c', 'clike'],
  ['objective-c++', 'clike'],
  ['c#', 'csharp'],
  ['csharp', 'csharp'],
  ['go', 'go'],
  ['java', 'java'],
  ['javascript', 'javascript'],
  ['typescript', 'typescript'],
  ['tsx', 'typescript'],
  ['python', 'python'],
  ['ruby', 'ruby'],
  ['php', 'php'],
  ['html', 'html'],
  ['css', 'css'],
  ['lua', 'lua'],
  ['sql', 'sql'],
  ['shell', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['makefile', 'makefile'],
  ['dockerfile', 'dockerfile'],
  ['cmake', 'cmake'],
  ['starlark', 'starlark'],
  ['bazel', 'starlark'],
  ['nix', 'nix'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['groovy', 'groovy'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['handlebars', 'handlebars'],
  ['mustache', 'mustache'],
  ['jinja', 'jinja'],
  ['jinja2', 'jinja'],
  ['django', 'jinja'],
  ['razor', 'razor'],
  ['protobuf', 'protobuf'],
  ['protocol buffer', 'protobuf'],
  ['protocol buffers', 'protobuf'],
  ['graphql', 'graphql'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['rust', 'rust'],
  ['perl', 'perl']
]);

const resolveLinguistId = (name, entry) => {
  const candidates = [name, ...(entry?.aliases || [])];
  for (const candidate of candidates) {
    const normalized = normalizeLinguistName(candidate);
    if (LINGUIST_NAME_TO_ID.has(normalized)) return LINGUIST_NAME_TO_ID.get(normalized);
  }
  return null;
};

const LINGUIST_EXTENSION_MAP = new Map();
const LINGUIST_FILENAME_MAP = new Map();
for (const [name, entry] of Object.entries(linguistLanguages || {})) {
  const languageId = resolveLinguistId(name, entry);
  if (!languageId || !LANGUAGE_BY_ID.has(languageId)) continue;
  for (const ext of entry?.extensions || []) {
    const key = String(ext || '').toLowerCase();
    if (key && !LINGUIST_EXTENSION_MAP.has(key)) {
      LINGUIST_EXTENSION_MAP.set(key, languageId);
    }
  }
  for (const filename of entry?.filenames || []) {
    const key = String(filename || '').toLowerCase();
    if (key && !LINGUIST_FILENAME_MAP.has(key)) {
      LINGUIST_FILENAME_MAP.set(key, languageId);
    }
  }
}

const resolveLinguistLanguage = (ext, relPath) => {
  const baseName = normalizeLinguistName(path.basename(relPath || ''));
  if (baseName && LINGUIST_FILENAME_MAP.has(baseName)) {
    return LANGUAGE_BY_ID.get(LINGUIST_FILENAME_MAP.get(baseName)) || null;
  }
  const extKey = normalizeLinguistName(ext);
  if (extKey && LINGUIST_EXTENSION_MAP.has(extKey)) {
    return LANGUAGE_BY_ID.get(LINGUIST_EXTENSION_MAP.get(extKey)) || null;
  }
  return null;
};

export function getLanguageForFile(ext, relPath) {
  const normalized = relPath || '';
  const direct = LANGUAGE_REGISTRY.find((lang) => lang.match(ext, normalized)) || null;
  if (direct) return direct;
  return resolveLinguistLanguage(ext, normalized);
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
