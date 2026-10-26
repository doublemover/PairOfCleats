import { createTypeScriptSyntaxContext, prepareTypeScriptSyntax, prepareTypeScriptBabelSyntax } from '../../lang/typescript/syntax-context.js';
import { preparedJavaScriptRelations, preparedJavaScriptFlow } from '../../lang/javascript/prepared-relations.js';
import { resolveJsTsExports } from '../../lang/js-ts-exports.js';
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
  isSql
} from '../constants.js';
import { buildCLikeChunks, buildCLikeRelations, collectCLikeImports, computeCLikeFlow, extractCLikeDocMeta } from '../../lang/clike.js';
import { buildGoChunks, buildGoRelations, collectGoImports, computeGoFlow, extractGoDocMeta } from '../../lang/go.js';
import { buildJavaChunks, buildJavaRelations, collectJavaImports, computeJavaFlow, extractJavaDocMeta } from '../../lang/java.js';
import { collectImports, extractDocMeta, parseJavaScriptAst } from '../../lang/javascript.js';
import { buildTypeScriptChunks, buildTypeScriptRelations, collectTypeScriptImports, computeTypeScriptFlow, extractTypeScriptDocMeta } from '../../lang/typescript.js';
import { buildCSharpChunks, buildCSharpRelations, collectCSharpImports, computeCSharpFlow, extractCSharpDocMeta } from '../../lang/csharp.js';
import * as kotlinLang from '../../lang/kotlin.js';
import { buildRubyChunks, buildRubyRelations, collectRubyImports, computeRubyFlow, extractRubyDocMeta } from '../../lang/ruby.js';
import { buildPhpChunks, buildPhpRelations, collectPhpImports, computePhpFlow, extractPhpDocMeta } from '../../lang/php.js';
import { buildHtmlChunks, buildHtmlRelations, collectHtmlImports, collectHtmlImportEntries, computeHtmlFlow, extractHtmlDocMeta, getHtmlMetadata } from '../../lang/html.js';
import { prepareCssChunkContext, buildCssRelations, collectCssImports, collectCssImportEntries, computeCssFlow, extractCssDocMeta } from '../../lang/css.js';
import { buildLuaChunks, buildLuaRelations, collectLuaImports, computeLuaFlow, extractLuaDocMeta } from '../../lang/lua.js';
import { buildSqlChunks, buildSqlRelations, collectSqlImports, computeSqlFlow, extractSqlDocMeta } from '../../lang/sql.js';
import { buildPerlChunks, buildPerlRelations, collectPerlImports, computePerlFlow, extractPerlDocMeta } from '../../lang/perl.js';
import {
  getPythonAst,
  collectPythonImportEntries,
  collectPythonImports,
  buildPythonRelations,
  extractPythonDocMeta
} from '../../lang/python.js';
import { preparePythonChunkContext } from '../../lang/python/prepared-chunks.js';
import { buildRustChunks, buildRustRelations, collectRustImports, computeRustFlow, extractRustDocMeta } from '../../lang/rust.js';
import { buildSwiftChunks, buildSwiftRelations, collectSwiftImports, computeSwiftFlow, extractSwiftDocMeta } from '../../lang/swift.js';
import { buildShellChunks, buildShellRelations, collectShellImports, computeShellFlow, extractShellDocMeta } from '../../lang/shell.js';
import { buildTreeSitterChunksAsync } from '../../lang/tree-sitter.js';
import { buildControlFlowOnly, PY_CONTROL_FLOW } from './control-flow.js';
import {
  buildConfigFileAdapters,
  buildHeuristicAdapters,
  createManagedAdapter,
  flowOptions,
  normalizeRelPath,
  shouldSkipPythonAstForFile
} from './adapters/index.js';

const {
  buildKotlinChunks,
  buildKotlinRelations,
  collectKotlinImports,
  computeKotlinFlow,
  extractKotlinDocMeta,
  getKotlinFileStats
} = kotlinLang;

/**
 * Normalize possibly-null option bags to plain objects for spread-safe merges.
 * @param {unknown} options
 * @returns {object}
 */
const toObjectOptions = (options) => (options && typeof options === 'object' ? options : {});

/**
 * Resolve per-language parser selector (e.g. `options.go.parser`).
 * @param {object} options
 * @param {string} parserScope
 * @returns {string|undefined}
 */
const resolveScopedParser = (options, parserScope) => options?.[parserScope]?.parser;

/**
 * Build options passed to chunk-building functions during `prepare`.
 * @param {object} input
 * @returns {object}
 */
export const buildChunkPrepareOptions = ({ options, relPath, ext, parserScope, extras = null }) => ({
  ...toObjectOptions(options),
  ext,
  relPath,
  parser: resolveScopedParser(options, parserScope),
  ...(extras || {})
});

/**
 * Build options passed to relation builders after chunk preparation.
 *
 * Relation options preserve legacy behavior by spreading the full options bag,
 * while still forcing scope-specific parser overrides.
 *
 * @param {object} input
 * @returns {object}
 */
export const buildChunkRelationOptions = ({ options, relPath, parserScope, extras = null }) => ({
  ...toObjectOptions(options),
  relPath,
  parser: resolveScopedParser(options, parserScope),
  ...(extras || {})
});

/**
 * Resolve SQL dialect for parser-backed SQL adapters.
 *
 * Priority:
 * 1. `options.resolveSqlDialect(ext)` callback
 * 2. `options.sql.dialect`
 * 3. `'generic'`
 *
 * @param {object} input
 * @returns {string}
 */
const resolveSqlDialect = ({ options, ext, relPath }) => (
  typeof options?.resolveSqlDialect === 'function'
    ? options.resolveSqlDialect(ext || path.extname(relPath || ''))
    : (options?.sql?.dialect || 'generic')
);

/**
 * Adapt collectors that return `{ imports }` payloads into plain list collectors.
 * @param {(text:string)=>{imports:string[]}} collector
 * @returns {(text:string)=>string[]}
 */
const collectImportsFromPayload = (collector) => (text) => collector(text).imports;

/**
 * Build a managed language adapter around parser-native chunk/relations APIs.
 *
 * The generated adapter guarantees shared parser selection across prepare and
 * relation phases and centralizes optional metadata hooks.
 *
 * @param {object} spec
 * @returns {object}
 */
const createParserChunkAdapter = ({
  id,
  match,
  collectImports,
  chunkKey,
  buildChunks,
  buildRelations,
  parserScope,
  extractDocMeta,
  flow,
  attachName = true,
  metadata = null,
  prepareExtras = null,
  relationExtras = null
}) => {
  const adapter = {
    id,
    match,
    collectImports,
    prepare: async ({ text, relPath, ext, options }) => {
      const extras = typeof prepareExtras === 'function'
        ? prepareExtras({ text, relPath, ext, options })
        : null;
      return {
        [chunkKey]: buildChunks(
          text,
          buildChunkPrepareOptions({
            options,
            relPath,
            ext,
            parserScope,
            extras
          })
        )
      };
    },
    buildRelations: ({ text, context, relPath, ext, options }) => {
      const extras = typeof relationExtras === 'function'
        ? relationExtras({ text, relPath, ext, options, context })
        : null;
      return buildRelations(
        text,
        context[chunkKey],
        buildChunkRelationOptions({
          options,
          relPath,
          parserScope,
          extras
        })
      );
    },
    extractDocMeta,
    flow: ({ text, chunk, options }) => flow(text, chunk, flowOptions(options)),
    attachName
  };
  if (typeof metadata === 'function') adapter.metadata = metadata;
  return adapter;
};

const createHtmlAdapter = () => {
  const adapter = createParserChunkAdapter({
    id: 'html', match: ext => isHtml(ext), collectImports: collectHtmlImports,
    chunkKey: 'htmlChunks', buildChunks: buildHtmlChunks, buildRelations: buildHtmlRelations,
    parserScope: 'html', flow: computeHtmlFlow, metadata: getHtmlMetadata
  });
  return {
    ...adapter,
    collectImportEntries: collectHtmlImportEntries,
    prepare: async input => ({ ...await adapter.prepare(input), htmlMeta: getHtmlMetadata(input.text) }),
    buildRelations: ({ text, context }) => buildHtmlRelations(text, context.htmlChunks, context.htmlMeta),
    extractDocMeta: ({ chunk, context }) => extractHtmlDocMeta(chunk, context?.htmlMeta)
  };
};

/**
 * Shared SQL adapter extras so chunking and relations use the same dialect.
 * @param {object} input
 * @returns {{dialect:string}}
 */
const sqlDialectExtras = ({ options, ext, relPath }) => ({
  dialect: resolveSqlDialect({ options, ext, relPath })
});

const PARSER_CHUNK_LANGUAGE_ADAPTERS = [
  createParserChunkAdapter({
    id: 'go',
    match: (ext) => isGo(ext),
    collectImports: collectGoImports,
    chunkKey: 'goChunks',
    buildChunks: buildGoChunks,
    buildRelations: buildGoRelations,
    parserScope: 'go',
    extractDocMeta: ({ chunk }) => extractGoDocMeta(chunk),
    flow: computeGoFlow
  }),
  createParserChunkAdapter({
    id: 'java',
    match: (ext) => isJava(ext),
    collectImports: collectJavaImports,
    chunkKey: 'javaChunks',
    buildChunks: buildJavaChunks,
    buildRelations: buildJavaRelations,
    parserScope: 'java',
    extractDocMeta: ({ chunk }) => extractJavaDocMeta(chunk),
    flow: computeJavaFlow
  }),
  createParserChunkAdapter({
    id: 'csharp',
    match: (ext) => isCSharp(ext),
    collectImports: collectCSharpImports,
    chunkKey: 'csChunks',
    buildChunks: buildCSharpChunks,
    buildRelations: buildCSharpRelations,
    parserScope: 'csharp',
    extractDocMeta: ({ chunk }) => extractCSharpDocMeta(chunk),
    flow: computeCSharpFlow
  }),
  createParserChunkAdapter({
    id: 'kotlin',
    match: (ext) => isKotlin(ext),
    collectImports: collectKotlinImports,
    chunkKey: 'kotlinChunks',
    buildChunks: buildKotlinChunks,
    buildRelations: buildKotlinRelations,
    parserScope: 'kotlin',
    extractDocMeta: ({ chunk, fileRelations }) => extractKotlinDocMeta(chunk, fileRelations),
    flow: computeKotlinFlow
  }),
  createParserChunkAdapter({
    id: 'ruby',
    match: (ext) => isRuby(ext),
    collectImports: collectRubyImports,
    chunkKey: 'rubyChunks',
    buildChunks: buildRubyChunks,
    buildRelations: buildRubyRelations,
    parserScope: 'ruby',
    extractDocMeta: ({ chunk }) => extractRubyDocMeta(chunk),
    flow: computeRubyFlow
  }),
  createParserChunkAdapter({
    id: 'php',
    match: (ext) => isPhp(ext),
    collectImports: collectPhpImports,
    chunkKey: 'phpChunks',
    buildChunks: buildPhpChunks,
    buildRelations: buildPhpRelations,
    parserScope: 'php',
    extractDocMeta: ({ chunk }) => extractPhpDocMeta(chunk),
    flow: computePhpFlow
  }),
  createHtmlAdapter(),
  createManagedAdapter({
    id: 'css', match: ext => isCss(ext), collectImports: collectCssImports, collectImportEntries: collectCssImportEntries,
    prepare: async ({ text, relPath, ext, options }) => {
      const cssOptions = buildChunkPrepareOptions({ options, relPath, ext, parserScope: 'css' });
      return prepareCssChunkContext(text, cssOptions);
    },
    buildRelations: ({ text, context, options }) => buildCssRelations(text, context.cssChunks,
      { ...options, cssSourceFacts: context.cssSourceFacts }),
    extractDocMeta: ({ chunk }) => extractCssDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeCssFlow(text, chunk, flowOptions(options)),
    attachName: true
  }),
  createParserChunkAdapter({
    id: 'lua',
    match: (ext) => isLua(ext),
    collectImports: collectLuaImports,
    chunkKey: 'luaChunks',
    buildChunks: buildLuaChunks,
    buildRelations: buildLuaRelations,
    parserScope: 'lua',
    extractDocMeta: ({ chunk }) => extractLuaDocMeta(chunk),
    flow: computeLuaFlow
  }),
  createParserChunkAdapter({
    id: 'sql',
    match: (ext) => isSql(ext),
    collectImports: collectSqlImports,
    chunkKey: 'sqlChunks',
    buildChunks: buildSqlChunks,
    buildRelations: buildSqlRelations,
    parserScope: 'sql',
    prepareExtras: sqlDialectExtras,
    relationExtras: sqlDialectExtras,
    extractDocMeta: ({ chunk, options }) => extractSqlDocMeta({ chunk, options }),
    flow: computeSqlFlow
  }),
  createParserChunkAdapter({
    id: 'perl',
    match: (ext) => isPerl(ext),
    collectImports: collectPerlImports,
    chunkKey: 'perlChunks',
    buildChunks: buildPerlChunks,
    buildRelations: buildPerlRelations,
    parserScope: 'perl',
    extractDocMeta: ({ chunk }) => extractPerlDocMeta(chunk),
    flow: computePerlFlow
  }),
  createParserChunkAdapter({
    id: 'shell',
    match: (ext) => isShell(ext),
    collectImports: collectShellImports,
    chunkKey: 'shellChunks',
    buildChunks: buildShellChunks,
    buildRelations: buildShellRelations,
    parserScope: 'shell',
    extractDocMeta: ({ chunk }) => extractShellDocMeta(chunk),
    flow: computeShellFlow
  }),
  createParserChunkAdapter({
    id: 'rust',
    match: (ext) => ext === '.rs',
    collectImports: collectRustImports,
    chunkKey: 'rustChunks',
    buildChunks: buildRustChunks,
    buildRelations: buildRustRelations,
    parserScope: 'rust',
    extractDocMeta: ({ chunk }) => extractRustDocMeta(chunk),
    flow: computeRustFlow
  }),
  createParserChunkAdapter({
    id: 'swift',
    match: (ext) => ext === '.swift',
    collectImports: collectImportsFromPayload(collectSwiftImports),
    chunkKey: 'swiftChunks',
    buildChunks: buildSwiftChunks,
    buildRelations: buildSwiftRelations,
    parserScope: 'swift',
    extractDocMeta: ({ chunk, context }) => extractSwiftDocMeta(chunk, context),
    flow: computeSwiftFlow
  })
];

const MANAGED_LANGUAGE_ADAPTERS = [
  {
    id: 'javascript',
    match: (ext) => isJsLike(ext),
    collectImports,
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
      context.jsAst = parseJavaScriptAst(text, { ...options, ext });
      return context;
    },
    buildRelations: ({ text, relPath, context, options, ext }) => preparedJavaScriptRelations(text, relPath, context, { ...options, ext }),
    extractDocMeta: ({ text, chunk, fileRelations, context, sourceView }) => ({
      ...extractDocMeta(text, chunk, fileRelations, sourceView), ...resolveJsTsExports(context?.jsAst, chunk)
    }),
    flow: preparedJavaScriptFlow,
    attachName: false
  },
  {
    id: 'typescript',
    match: (ext) => isTypeScript(ext),
    collectImports: collectTypeScriptImports,
    prepare: async ({ text, mode, ext, relPath, options }) => {
      if (mode !== 'code') return {};
      const typeScriptSyntaxContext = createTypeScriptSyntaxContext();
      const syntaxOptions = { ...options, ext, relPath, typeScriptSyntaxContext };
      const tsSyntax = options?.semanticEnabled ? prepareTypeScriptSyntax(text, syntaxOptions) : null;
      if (options?.typescript?.importsOnly === true) return { tsSyntax, typeScriptSyntaxContext };
      let tsChunks = await buildTreeSitterChunksAsync({
        text,
        languageId: ext === '.tsx' ? 'tsx' : 'typescript',
        ext,
        options
      });
      if (!tsChunks || !tsChunks.length) {
        tsChunks = buildTypeScriptChunks(text, {
          ...(options && typeof options === 'object' ? options : {}),
          ext,
          relPath,
          typeScriptSyntaxContext,
          parser: options?.typescript?.parser
        });
      }
      const exportAst = prepareTypeScriptBabelSyntax(text, syntaxOptions);
      return { tsChunks, tsSyntax, typeScriptSyntaxContext, exportAst };
    },
    buildRelations: ({ text, context, options, ext }) => {
      if (options?.typescript?.importsOnly === true) {
        const imports = collectTypeScriptImports(text, { ...options, ext, typeScriptSyntaxContext: context.typeScriptSyntaxContext });
        return {
          imports,
          exports: [],
          calls: [],
          usages: []
        };
      }
      return buildTypeScriptRelations(text, context.tsChunks, { ...options, ext, typeScriptSyntaxContext: context.typeScriptSyntaxContext });
    },
    extractDocMeta: ({ chunk, context }) => ({
      ...extractTypeScriptDocMeta(chunk), ...resolveJsTsExports(context?.exportAst, chunk)
    }),
    flow: ({ text, chunk, options }) => (options?.typescript?.importsOnly === true
      ? null
      : computeTypeScriptFlow(text, chunk, flowOptions(options))),
    attachName: true
  },
  {
    id: 'python',
    match: (ext) => ext === '.py',
    collectImportEntries: collectPythonImportEntries,
    prepare: async ({ text, mode, relPath, options }) => {
      if (mode !== 'code') return {};
      let pythonAst = null;
      let pythonAstMetrics = null;
      const pythonAstEnabled = options?.pythonAst?.enabled !== false;
      const pythonAstSkip = shouldSkipPythonAstForFile({ text, relPath, options });
      const runPythonAst = pythonAstEnabled && !pythonAstSkip.skip;
      if (runPythonAst) {
        const python = await getPythonAst(text, options?.log, {
          ...options,
          dataflow: options?.astDataflowEnabled,
          controlFlow: options?.controlFlowEnabled,
          path: options?.filePath || relPath || null
        });
        if (python?.ast) pythonAst = python.ast;
        if (python?.metrics) pythonAstMetrics = python.metrics;
      } else if (pythonAstEnabled && pythonAstSkip.skip && typeof options?.log === 'function') {
        options.log(
          `[python-ast] skip ${normalizeRelPath(relPath || options?.filePath || '')} `
          + `(${pythonAstSkip.reason || 'policy'}).`
        );
      }
      return preparePythonChunkContext({ text, pythonAst, pythonAstMetrics });
    },
    buildRelations: ({ text, context }) => buildPythonRelations(text, context.pythonAst),
    extractDocMeta: ({ chunk, fileRelations, context }) =>
      extractPythonDocMeta(chunk, fileRelations, context),
    flow: ({ text, chunk, options }) => buildControlFlowOnly(text, chunk, options, PY_CONTROL_FLOW),
    attachName: false
  },
  {
    id: 'clike',
    match: (ext) => isCLike(ext),
    collectImports: collectCLikeImports,
    prepare: ({ text, ext, options }) => ({ clikeChunks: buildCLikeChunks(text, ext, options) }),
    buildRelations: ({ text, ext, context, options }) => buildCLikeRelations(text, context.clikeChunks, { ...options, ext }),
    extractDocMeta: ({ chunk }) => extractCLikeDocMeta(chunk),
    flow: ({ text, chunk, options }) => computeCLikeFlow(text, chunk, flowOptions(options)),
    attachName: true
  },
  ...PARSER_CHUNK_LANGUAGE_ADAPTERS
];

/**
 * Ordered language adapter registry used by index build pipelines.
 *
 * Precedence is intentional:
 * 1. Managed adapters (parser-backed and orchestrated fallbacks)
 * 2. Heuristic adapters
 * 3. Config/document format adapters
 */
export const LANGUAGE_REGISTRY = [
  ...MANAGED_LANGUAGE_ADAPTERS.map((adapter) => createManagedAdapter(adapter)),
  ...buildHeuristicAdapters(),
  ...buildConfigFileAdapters()
];
