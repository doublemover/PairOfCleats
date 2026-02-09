import path from 'node:path';
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
} from '../constants.js';
import { buildCLikeChunks, buildCLikeRelations, collectCLikeImports, computeCLikeFlow, extractCLikeDocMeta } from '../../lang/clike.js';
import { buildGoChunks, buildGoRelations, collectGoImports, computeGoFlow, extractGoDocMeta } from '../../lang/go.js';
import { buildJavaChunks, buildJavaRelations, collectJavaImports, computeJavaFlow, extractJavaDocMeta } from '../../lang/java.js';
import { buildCodeRelations, collectImports, extractDocMeta, parseJavaScriptAst } from '../../lang/javascript.js';
import { buildTypeScriptChunks, buildTypeScriptRelations, collectTypeScriptImports, computeTypeScriptFlow, extractTypeScriptDocMeta } from '../../lang/typescript.js';
import { buildCSharpChunks, buildCSharpRelations, collectCSharpImports, computeCSharpFlow, extractCSharpDocMeta } from '../../lang/csharp.js';
import * as kotlinLang from '../../lang/kotlin.js';
import { buildRubyChunks, buildRubyRelations, collectRubyImports, computeRubyFlow, extractRubyDocMeta } from '../../lang/ruby.js';
import { buildPhpChunks, buildPhpRelations, collectPhpImports, computePhpFlow, extractPhpDocMeta } from '../../lang/php.js';
import { buildHtmlChunks, buildHtmlRelations, collectHtmlImports, computeHtmlFlow, extractHtmlDocMeta, getHtmlMetadata } from '../../lang/html.js';
import { buildCssChunks, buildCssRelations, collectCssImports, computeCssFlow, extractCssDocMeta } from '../../lang/css.js';
import { buildLuaChunks, buildLuaRelations, collectLuaImports, computeLuaFlow, extractLuaDocMeta } from '../../lang/lua.js';
import { buildSqlChunks, buildSqlRelations, collectSqlImports, computeSqlFlow, extractSqlDocMeta } from '../../lang/sql.js';
import { buildPerlChunks, buildPerlRelations, collectPerlImports, computePerlFlow, extractPerlDocMeta } from '../../lang/perl.js';
import {
  getPythonAst,
  collectPythonImports,
  buildPythonRelations,
  extractPythonDocMeta,
  buildPythonChunksFromAst,
  buildPythonHeuristicChunks
} from '../../lang/python.js';
import { buildRustChunks, buildRustRelations, collectRustImports, computeRustFlow, extractRustDocMeta } from '../../lang/rust.js';
import { buildSwiftChunks, buildSwiftRelations, collectSwiftImports, computeSwiftFlow, extractSwiftDocMeta } from '../../lang/swift.js';
import { buildShellChunks, buildShellRelations, collectShellImports, computeShellFlow, extractShellDocMeta } from '../../lang/shell.js';
import { buildTreeSitterChunksAsync } from '../../lang/tree-sitter.js';
import { buildControlFlowOnly, JS_CONTROL_FLOW, PY_CONTROL_FLOW } from './control-flow.js';
import { buildSimpleRelations } from './simple-relations.js';
import { collectCmakeImports } from './import-collectors/cmake.js';
import { collectDartImports } from './import-collectors/dart.js';
import { collectDockerfileImports } from './import-collectors/dockerfile.js';
import { collectGraphqlImports } from './import-collectors/graphql.js';
import { collectGroovyImports } from './import-collectors/groovy.js';
import { collectHandlebarsImports } from './import-collectors/handlebars.js';
import { collectJinjaImports } from './import-collectors/jinja.js';
import { collectJuliaImports } from './import-collectors/julia.js';
import { collectMakefileImports } from './import-collectors/makefile.js';
import { collectMustacheImports } from './import-collectors/mustache.js';
import { collectNixImports } from './import-collectors/nix.js';
import { collectProtoImports } from './import-collectors/proto.js';
import { collectRazorImports } from './import-collectors/razor.js';
import { collectRImports } from './import-collectors/r.js';
import { collectScalaImports } from './import-collectors/scala.js';
import { collectStarlarkImports } from './import-collectors/starlark.js';

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

export const LANGUAGE_REGISTRY = [
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
    buildRelations: ({ text, relPath, context, options, ext }) =>
      buildCodeRelations(text, relPath, {
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
    buildRelations: ({ text, context, options, ext }) => {
      if (options?.typescript?.importsOnly === true) {
        const imports = collectTypeScriptImports(text, { ...options, ext });
        return {
          imports,
          exports: [],
          calls: [],
          usages: []
        };
      }
      return buildTypeScriptRelations(text, context.tsChunks, { ...options, ext });
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
    prepare: async ({ text, mode, relPath, options }) => {
      if (mode !== 'code') return {};
      let pythonAst = null;
      let pythonAstMetrics = null;
      let pythonChunks = null;
      const pythonAstEnabled = options?.pythonAst?.enabled !== false;
      if (pythonAstEnabled) {
        const python = await getPythonAst(text, options?.log, {
          ...options,
          dataflow: options?.astDataflowEnabled,
          controlFlow: options?.controlFlowEnabled,
          path: options?.filePath || relPath || null
        });
        if (python?.ast) pythonAst = python.ast;
        if (python?.metrics) pythonAstMetrics = python.metrics;
      }
      if (pythonAst) {
        pythonChunks = buildPythonChunksFromAst(text, pythonAst);
      }
      if (!pythonChunks || !pythonChunks.length) {
        pythonChunks = buildPythonHeuristicChunks(text);
      }
      return { pythonAst, pythonAstMetrics, pythonChunks };
    },
    buildRelations: ({ text, relPath, context, options }) =>
      buildPythonRelations(text, relPath, context.pythonAst, options),
    extractDocMeta: ({ chunk, fileRelations, context }) =>
      extractPythonDocMeta(chunk, fileRelations, context),
    flow: ({ text, chunk, options }) => buildControlFlowOnly(text, chunk, options, PY_CONTROL_FLOW),
    attachName: false
  },
  {
    id: 'clike',
    match: (ext) => isCLike(ext),
    collectImports: (text, options) => collectCLikeImports(text, options),
    buildRelations: ({ text, relPath, options }) => buildCLikeRelations(text, relPath, options),
    extractDocMeta: ({ text, chunk, fileRelations }) => extractCLikeDocMeta(text, chunk, fileRelations),
    flow: ({ text, chunk, options }) => computeCLikeFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'go',
    match: (ext) => isGo(ext),
    collectImports: (text, options) => collectGoImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const goChunks = buildGoChunks(text, { relPath, parser: options?.go?.parser });
      return { goChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildGoRelations(text, context.goChunks, { relPath, parser: options?.go?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractGoDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeGoFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'java',
    match: (ext) => isJava(ext),
    collectImports: (text, options) => collectJavaImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const javaChunks = buildJavaChunks(text, { relPath, parser: options?.java?.parser });
      return { javaChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildJavaRelations(text, context.javaChunks, { relPath, parser: options?.java?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractJavaDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeJavaFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'csharp',
    match: (ext) => isCSharp(ext),
    collectImports: (text, options) => collectCSharpImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const csChunks = buildCSharpChunks(text, { relPath, parser: options?.csharp?.parser });
      return { csChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildCSharpRelations(text, context.csChunks, { relPath, parser: options?.csharp?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractCSharpDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeCSharpFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'kotlin',
    match: (ext) => isKotlin(ext),
    collectImports: (text, options) => collectKotlinImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const kotlinChunks = buildKotlinChunks(text, { relPath, parser: options?.kotlin?.parser });
      return { kotlinChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildKotlinRelations(text, context.kotlinChunks, { relPath, parser: options?.kotlin?.parser, ...options }),
    extractDocMeta: ({ chunk, fileRelations }) => extractKotlinDocMeta(chunk, fileRelations),
    flow: ({ text, chunk, options }) => computeKotlinFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'ruby',
    match: (ext) => isRuby(ext),
    collectImports: (text, options) => collectRubyImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const rubyChunks = buildRubyChunks(text, { relPath, parser: options?.ruby?.parser });
      return { rubyChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildRubyRelations(text, context.rubyChunks, { relPath, parser: options?.ruby?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractRubyDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeRubyFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'php',
    match: (ext) => isPhp(ext),
    collectImports: (text, options) => collectPhpImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const phpChunks = buildPhpChunks(text, { relPath, parser: options?.php?.parser });
      return { phpChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildPhpRelations(text, context.phpChunks, { relPath, parser: options?.php?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractPhpDocMeta(chunk),
    flow: ({ text, chunk, options }) => computePhpFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'html',
    match: (ext) => isHtml(ext),
    collectImports: (text, options) => collectHtmlImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const htmlChunks = buildHtmlChunks(text, { relPath, parser: options?.html?.parser });
      return { htmlChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildHtmlRelations(text, context.htmlChunks, { relPath, parser: options?.html?.parser, ...options }),
    extractDocMeta: ({ chunk, fileRelations }) => extractHtmlDocMeta(chunk, fileRelations),
    flow: ({ text, chunk, options }) => computeHtmlFlow(text, chunk, flowOptions(options)),
    attachName: true,
    metadata: getHtmlMetadata
  },
  {
    id: 'css',
    match: (ext) => isCss(ext),
    collectImports: (text, options) => collectCssImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const cssChunks = buildCssChunks(text, { relPath, parser: options?.css?.parser });
      return { cssChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildCssRelations(text, context.cssChunks, { relPath, parser: options?.css?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractCssDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeCssFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'lua',
    match: (ext) => isLua(ext),
    collectImports: (text, options) => collectLuaImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const luaChunks = buildLuaChunks(text, { relPath, parser: options?.lua?.parser });
      return { luaChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildLuaRelations(text, context.luaChunks, { relPath, parser: options?.lua?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractLuaDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeLuaFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'sql',
    match: (ext) => isSql(ext),
    collectImports: (text, options) => collectSqlImports(text, options),
    prepare: async ({ text, relPath, ext, options }) => {
      const dialect = typeof options?.resolveSqlDialect === 'function'
        ? options.resolveSqlDialect(ext || path.extname(relPath || ''))
        : (options?.sql?.dialect || 'generic');
      const sqlChunks = buildSqlChunks(text, {
        relPath,
        parser: options?.sql?.parser,
        dialect
      });
      return { sqlChunks };
    },
    buildRelations: ({ text, context, relPath, ext, options }) => {
      const dialect = typeof options?.resolveSqlDialect === 'function'
        ? options.resolveSqlDialect(ext || path.extname(relPath || ''))
        : (options?.sql?.dialect || 'generic');
      return buildSqlRelations(text, context.sqlChunks, {
        relPath,
        parser: options?.sql?.parser,
        dialect,
        ...options
      });
    },
    extractDocMeta: ({ chunk }) => extractSqlDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeSqlFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'perl',
    match: (ext) => isPerl(ext),
    collectImports: (text, options) => collectPerlImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const perlChunks = buildPerlChunks(text, { relPath, parser: options?.perl?.parser });
      return { perlChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildPerlRelations(text, context.perlChunks, { relPath, parser: options?.perl?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractPerlDocMeta(chunk),
    flow: ({ text, chunk, options }) => computePerlFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'shell',
    match: (ext) => isShell(ext),
    collectImports: (text, options) => collectShellImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const shellChunks = buildShellChunks(text, { relPath, parser: options?.shell?.parser });
      return { shellChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildShellRelations(text, context.shellChunks, { relPath, parser: options?.shell?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractShellDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeShellFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'rust',
    match: (ext) => ext === '.rs',
    collectImports: (text, options) => collectRustImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const rustChunks = buildRustChunks(text, { relPath, parser: options?.rust?.parser });
      return { rustChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildRustRelations(text, context.rustChunks, { relPath, parser: options?.rust?.parser, ...options }),
    extractDocMeta: ({ chunk }) => extractRustDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeRustFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'swift',
    match: (ext) => ext === '.swift',
    collectImports: (text, options) => collectSwiftImports(text, options),
    prepare: async ({ text, relPath, options }) => {
      const swiftChunks = buildSwiftChunks(text, { relPath, parser: options?.swift?.parser });
      return { swiftChunks };
    },
    buildRelations: ({ text, context, relPath, options }) =>
      buildSwiftRelations(text, context.swiftChunks, { relPath, parser: options?.swift?.parser, ...options }),
    extractDocMeta: ({ chunk, context }) => extractSwiftDocMeta(chunk, context),
    flow: ({ text, chunk, options }) => computeSwiftFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  {
    id: 'cmake',
    match: (ext) => CMAKE_EXTS.has(ext),
    collectImports: (text) => collectCmakeImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectCmakeImports(text) }),
    attachName: false
  },
  {
    id: 'starlark',
    match: (ext) => STARLARK_EXTS.has(ext),
    collectImports: (text) => collectStarlarkImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectStarlarkImports(text) }),
    attachName: false
  },
  {
    id: 'nix',
    match: (ext) => NIX_EXTS.has(ext),
    collectImports: (text) => collectNixImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectNixImports(text) }),
    attachName: false
  },
  {
    id: 'dart',
    match: (ext) => DART_EXTS.has(ext),
    collectImports: (text) => collectDartImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectDartImports(text) }),
    attachName: false
  },
  {
    id: 'scala',
    match: (ext) => SCALA_EXTS.has(ext),
    collectImports: (text) => collectScalaImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectScalaImports(text) }),
    attachName: false
  },
  {
    id: 'groovy',
    match: (ext) => GROOVY_EXTS.has(ext),
    collectImports: (text) => collectGroovyImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectGroovyImports(text) }),
    attachName: false
  },
  {
    id: 'r',
    match: (ext) => R_EXTS.has(ext),
    collectImports: (text) => collectRImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectRImports(text) }),
    attachName: false
  },
  {
    id: 'julia',
    match: (ext) => JULIA_EXTS.has(ext),
    collectImports: (text) => collectJuliaImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectJuliaImports(text) }),
    attachName: false
  },
  {
    id: 'handlebars',
    match: (ext) => HANDLEBARS_EXTS.has(ext),
    collectImports: (text) => collectHandlebarsImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectHandlebarsImports(text) }),
    attachName: false
  },
  {
    id: 'mustache',
    match: (ext) => MUSTACHE_EXTS.has(ext),
    collectImports: (text) => collectMustacheImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectMustacheImports(text) }),
    attachName: false
  },
  {
    id: 'jinja',
    match: (ext) => JINJA_EXTS.has(ext),
    collectImports: (text) => collectJinjaImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectJinjaImports(text) }),
    attachName: false
  },
  {
    id: 'razor',
    match: (ext) => RAZOR_EXTS.has(ext),
    collectImports: (text) => collectRazorImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectRazorImports(text) }),
    attachName: false
  },
  {
    id: 'proto',
    match: (ext, relPath) => ext === '.proto' || relPath === 'buf.gen.yaml' || relPath === 'buf.yaml',
    collectImports: (text, options) => collectProtoImports(text, options),
    buildRelations: ({ text, options }) => buildSimpleRelations({ imports: collectProtoImports(text, options) }),
    attachName: false
  },
  {
    id: 'makefile',
    match: (_ext, relPath) => relPath && relPath.toLowerCase() === 'makefile',
    collectImports: (text) => collectMakefileImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectMakefileImports(text) }),
    attachName: false
  },
  {
    id: 'dockerfile',
    match: (_ext, relPath) => relPath && relPath.toLowerCase() === 'dockerfile',
    collectImports: (text) => collectDockerfileImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectDockerfileImports(text) }),
    attachName: false
  },
  {
    id: 'graphql',
    match: (ext) => ext === '.graphql' || ext === '.gql',
    collectImports: (text) => collectGraphqlImports(text),
    buildRelations: ({ text }) => buildSimpleRelations({ imports: collectGraphqlImports(text) }),
    attachName: false
  }
];
