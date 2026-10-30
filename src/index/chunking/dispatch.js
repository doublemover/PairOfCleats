import { unicodeScalarBoundary } from '../../shared/unicode-chunks.js';
import { createRequire } from 'node:module';
import { deferLanguageFunctions } from '../deferred-language-functions.js';
import {
  isCLike,
  isGo,
  isJava,
  isJsLike,
  isPerl,
  isRust,
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
  MARKDOWN_EXTS,
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
import { applyChunkingLimits } from './limits.js';
import { getTreeSitterOptions } from './tree-sitter.js';
import {
  buildLimitContext,
  chunkLargeProseFallback,
  resolveChunker,
  tryTreeSitterChunks
} from './dispatch/shared.js';
const require = createRequire(import.meta.url);

const { buildJsChunks } = deferLanguageFunctions(
  () => require('../../lang/javascript.js'),
  ['buildJsChunks']
);
const { buildTypeScriptChunks } = deferLanguageFunctions(
  () => require('../../lang/typescript.js'),
  ['buildTypeScriptChunks']
);
const { buildCSharpChunks } = deferLanguageFunctions(
  () => require('../../lang/csharp.js'),
  ['buildCSharpChunks']
);
const { buildKotlinChunks } = deferLanguageFunctions(
  () => require('../../lang/kotlin.js'),
  ['buildKotlinChunks']
);
const { buildRubyChunks } = deferLanguageFunctions(
  () => require('../../lang/ruby.js'),
  ['buildRubyChunks']
);
const { buildPhpChunks } = deferLanguageFunctions(
  () => require('../../lang/php.js'),
  ['buildPhpChunks']
);
const { buildHtmlChunks } = deferLanguageFunctions(
  () => require('../../lang/html.js'),
  ['buildHtmlChunks']
);
const { resolveCssPreparedChunks } = deferLanguageFunctions(
  () => require('../../lang/css.js'),
  ['resolveCssPreparedChunks']
);
const { buildLuaChunks } = deferLanguageFunctions(
  () => require('../../lang/lua.js'),
  ['buildLuaChunks']
);
const { buildSqlChunks } = deferLanguageFunctions(
  () => require('../../lang/sql.js'),
  ['buildSqlChunks']
);
const { buildCLikeChunks } = deferLanguageFunctions(
  () => require('../../lang/clike.js'),
  ['buildCLikeChunks']
);
const { resolvePythonPreparedChunks } = deferLanguageFunctions(
  () => require('../../lang/python/prepared-chunks.js'),
  ['resolvePythonPreparedChunks']
);
const { buildRustChunks } = deferLanguageFunctions(
  () => require('../../lang/rust.js'),
  ['buildRustChunks']
);
const { buildSwiftChunks } = deferLanguageFunctions(
  () => require('../../lang/swift.js'),
  ['buildSwiftChunks']
);
const { buildGoChunks } = deferLanguageFunctions(
  () => require('../../lang/go.js'),
  ['buildGoChunks']
);
const { buildJavaChunks } = deferLanguageFunctions(
  () => require('../../lang/java.js'),
  ['buildJavaChunks']
);
const { buildPerlChunks } = deferLanguageFunctions(
  () => require('../../lang/perl.js'),
  ['buildPerlChunks']
);
const { buildShellChunks } = deferLanguageFunctions(
  () => require('../../lang/shell.js'),
  ['buildShellChunks']
);
const { chunkIniToml } = deferLanguageFunctions(
  () => require('./formats/ini-toml.js'),
  ['chunkIniToml']
);
const { chunkJson } = deferLanguageFunctions(
  () => require('./formats/json.js'),
  ['chunkJson']
);
const { chunkDocxDocument } = deferLanguageFunctions(
  () => require('./formats/docx.js'),
  ['chunkDocxDocument']
);
const { chunkMarkdown } = deferLanguageFunctions(
  () => require('./formats/markdown.js'),
  ['chunkMarkdown']
);
const { chunkPdfDocument } = deferLanguageFunctions(
  () => require('./formats/pdf.js'),
  ['chunkPdfDocument']
);
const { chunkRst, chunkAsciiDoc } = deferLanguageFunctions(
  () => require('./formats/rst-asciidoc.js'),
  ['chunkRst', 'chunkAsciiDoc']
);
const { chunkXml } = deferLanguageFunctions(
  () => require('./formats/xml.js'),
  ['chunkXml']
);
const { chunkYaml } = deferLanguageFunctions(
  () => require('./formats/yaml.js'),
  ['chunkYaml']
);

const {
  chunkCmake,
  chunkDart,
  chunkDockerfile,
  chunkGroovy,
  chunkHandlebars,
  chunkJinja,
  chunkJulia,
  chunkMakefile,
  chunkMustache,
  chunkNix,
  chunkR,
  chunkRazor,
  chunkScala,
  chunkStarlark
} = deferLanguageFunctions(
  () => require('./dispatch/heuristic-chunkers.js'),
  [
    'chunkCmake',
    'chunkDart',
    'chunkDockerfile',
    'chunkGroovy',
    'chunkHandlebars',
    'chunkJinja',
    'chunkJulia',
    'chunkMakefile',
    'chunkMustache',
    'chunkNix',
    'chunkR',
    'chunkRazor',
    'chunkScala',
    'chunkStarlark'
  ]
);
const { chunkGraphql, chunkProto } = deferLanguageFunctions(
  () => require('./dispatch/schema-chunkers.js'),
  ['chunkGraphql', 'chunkProto']
);

const INI_LIKE_EXTS = new Set(['.toml', '.ini', '.cfg', '.conf']);

/**
 * Ordered code chunker registry.
 *
 * Dispatch uses first-match semantics, so earlier entries intentionally have
 * higher precedence when extensions overlap or when parser/fallback behavior
 * differs across language families.
 */
const CODE_CHUNKERS = [
  {
    id: 'javascript',
    match: (ext) => isJsLike(ext),
    chunk: ({ text, ext, context }) => {
      if (context?.jsChunks) return context.jsChunks;
      return buildJsChunks(text, {
        ext,
        ast: context?.jsAst,
        javascript: context?.javascript,
        flowMode: context?.javascript?.flow,
        treeSitter: context?.treeSitter,
        log: context?.log
      });
    }
  },
  {
    id: 'typescript',
    match: (ext) => isTypeScript(ext),
    chunk: ({ text, ext, relPath, context }) => {
      if (context?.tsChunks) return context.tsChunks;
      const parser = context?.typescript?.importsOnly ? 'heuristic' : context?.typescript?.parser;
      return buildTypeScriptChunks(text, {
        typeScriptSyntaxContext: context?.typeScriptSyntaxContext, sourceFile: context?.tsSyntax?.sourceFile, ts: context?.tsSyntax?.ts,
        ext,
        relPath,
        parser,
        treeSitter: context?.treeSitter,
        log: context?.log
      });
    }
  },
  {
    id: 'html',
    match: (ext) => isHtml(ext),
    chunk: ({ text, context }) => context?.htmlChunks || buildHtmlChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'css',
    match: (ext) => isCss(ext),
    chunk: ({ text, context }) => resolveCssPreparedChunks(text, context, getTreeSitterOptions(context))
  },
  {
    id: 'python',
    match: (ext) => ext === '.py',
    chunk: ({ text, context }) => resolvePythonPreparedChunks(text, context)
  },
  {
    id: 'swift',
    match: (ext) => ext === '.swift',
    chunk: ({ text, context }) => context?.swiftChunks || buildSwiftChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'clike',
    match: (ext) => isCLike(ext),
    chunk: ({ text, ext, context }) => context?.clikeChunks || buildCLikeChunks(text, ext, getTreeSitterOptions(context))
  },
  {
    id: 'rust',
    match: (ext) => isRust(ext),
    chunk: ({ text, context }) => context?.rustChunks || buildRustChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'go',
    match: (ext) => isGo(ext),
    chunk: ({ text, context }) => context?.goChunks || buildGoChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'java',
    match: (ext) => isJava(ext),
    chunk: ({ text, context }) => context?.javaChunks || buildJavaChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'perl',
    match: (ext) => isPerl(ext),
    chunk: ({ text, context }) => context?.perlChunks || buildPerlChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'shell',
    match: (ext) => isShell(ext),
    chunk: ({ text, context }) => context?.shellChunks || buildShellChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'dockerfile',
    match: (ext) => ext === '.dockerfile',
    chunk: ({ text, context }) => chunkDockerfile(text, context)
  },
  {
    id: 'makefile',
    match: (ext) => ext === '.makefile',
    chunk: ({ text, context }) => chunkMakefile(text, context)
  },
  {
    id: 'csharp',
    match: (ext) => isCSharp(ext),
    chunk: ({ text, context }) => context?.csharpChunks || buildCSharpChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'kotlin',
    match: (ext) => isKotlin(ext),
    chunk: ({ text, context }) => context?.kotlinChunks || buildKotlinChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'ruby',
    match: (ext) => isRuby(ext),
    chunk: ({ text, context }) => context?.rubyChunks || buildRubyChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'php',
    match: (ext) => isPhp(ext),
    chunk: ({ text, context }) => context?.phpChunks || buildPhpChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'lua',
    match: (ext) => isLua(ext),
    chunk: ({ text, context }) => context?.luaChunks || buildLuaChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'sql',
    match: (ext) => isSql(ext),
    chunk: ({ text, context }) => context?.sqlChunks || buildSqlChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'proto',
    match: (ext) => ext === '.proto',
    chunk: ({ text, context }) => chunkProto(text, context)
  },
  {
    id: 'graphql',
    match: (ext) => ext === '.graphql' || ext === '.gql' || ext === '.graphqls',
    chunk: ({ text, context }) => chunkGraphql(text, context)
  },
  { id: 'cmake', match: (ext) => CMAKE_EXTS.has(ext), chunk: ({ text, context }) => chunkCmake(text, context) },
  { id: 'starlark', match: (ext) => STARLARK_EXTS.has(ext), chunk: ({ text, context }) => chunkStarlark(text, context) },
  { id: 'nix', match: (ext) => NIX_EXTS.has(ext), chunk: ({ text, context }) => chunkNix(text, context) },
  {
    id: 'dart',
    match: (ext) => DART_EXTS.has(ext),
    chunk: ({ text, context }) => context?.dartChunks || tryTreeSitterChunks(text, 'dart', context) || chunkDart(text, context)
  },
  {
    id: 'scala',
    match: (ext) => SCALA_EXTS.has(ext),
    chunk: ({ text, context }) => context?.scalaChunks || tryTreeSitterChunks(text, 'scala', context) || chunkScala(text, context)
  },
  {
    id: 'groovy',
    match: (ext) => GROOVY_EXTS.has(ext),
    chunk: ({ text, context }) => context?.groovyChunks || tryTreeSitterChunks(text, 'groovy', context) || chunkGroovy(text, context)
  },
  {
    id: 'r',
    match: (ext) => R_EXTS.has(ext),
    chunk: ({ text, context }) => context?.rChunks || tryTreeSitterChunks(text, 'r', context) || chunkR(text, context)
  },
  {
    id: 'julia',
    match: (ext) => JULIA_EXTS.has(ext),
    chunk: ({ text, context }) => context?.juliaChunks || tryTreeSitterChunks(text, 'julia', context) || chunkJulia(text, context)
  },
  {
    id: 'handlebars',
    match: (ext) => HANDLEBARS_EXTS.has(ext),
    chunk: ({ text, context }) => chunkHandlebars(text, context)
  },
  {
    id: 'mustache',
    match: (ext) => MUSTACHE_EXTS.has(ext),
    chunk: ({ text, context }) => chunkMustache(text, context)
  },
  {
    id: 'jinja',
    match: (ext) => JINJA_EXTS.has(ext),
    chunk: ({ text, ext, relPath, context }) => chunkJinja(text, { ...context, ext, relPath })
  },
  {
    id: 'razor',
    match: (ext) => RAZOR_EXTS.has(ext),
    chunk: ({ text, context }) => chunkRazor(text, context)
  }
];

/**
 * Secondary dispatch table for code-like data formats that are not handled by
 * the primary language adapters.
 *
 * This table is only consulted after `CODE_CHUNKERS` misses or produces no
 * chunks, preserving language chunker precedence.
 */
const CODE_FORMAT_CHUNKERS = [
  { id: 'json', match: (ext) => ['.json', '.jsonc', '.resolved'].includes(ext),
    chunk: ({ text, ext, relPath, context }) => chunkJson(text, { ...context, ext, relPath }) },
  {
    id: 'ini',
    match: (ext) => INI_LIKE_EXTS.has(ext),
    chunk: ({ text, ext, context }) => chunkIniToml(text, ext === '.toml' ? 'toml' : 'ini', context)
  },
  { id: 'xml', match: (ext) => ext === '.xml', chunk: ({ text, context }) => chunkXml(text, context) },
  {
    id: 'yaml',
    match: (ext) => ext === '.yaml' || ext === '.yml',
    chunk: ({ text, relPath, context }) => chunkYaml(text, relPath, context)
  },
  {
    id: 'proto',
    match: (ext) => ext === '.proto',
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'proto', context) || chunkProto(text, context)
  },
  {
    id: 'graphql',
    match: (ext) => ext === '.graphql' || ext === '.gql',
    chunk: ({ text, context }) => chunkGraphql(text, context)
  }
];

/**
 * Prose/document chunker registry used when indexing in `prose` mode.
 *
 * Missing handlers fall back to large-prose chunk slicing in `smartChunk`.
 */
const PROSE_CHUNKERS = [
  { id: 'pdf', match: (ext) => ext === '.pdf', chunk: ({ text, context }) => chunkPdfDocument(text, context) },
  { id: 'docx', match: (ext) => ext === '.docx', chunk: ({ text, context }) => chunkDocxDocument(text, context) },
  {
    id: 'markdown',
    match: (ext) => MARKDOWN_EXTS.has(ext),
    chunk: ({ text, ext, context }) => chunkMarkdown(text, ext, context)
  },
  { id: 'rst', match: (ext) => ext === '.rst', chunk: ({ text }) => chunkRst(text) },
  {
    id: 'asciidoc',
    match: (ext) => ext === '.adoc' || ext === '.asciidoc',
    chunk: ({ text }) => chunkAsciiDoc(text)
  }
];

/**
 * Build chunks for a single file using ordered language/format dispatch.
 *
 * Fallback behavior is deterministic and mode-sensitive:
 * 1. `prose`: try prose chunker by extension, then large-prose fallback.
 * 2. `code`: try language chunker, then code-format chunker.
 * 3. final fallback: fixed-width slices (`800` chars) with mode-specific kind.
 *
 * All successful paths pass through `applyChunkingLimits` so configured
 * truncation/capping rules are enforced consistently.
 *
 * @param {object} params
 * @param {string} params.text
 * @param {string} params.ext
 * @param {string|null} [params.relPath]
 * @param {'code'|'prose'} params.mode
 * @param {object} [params.context]
 * @returns {Array<{start:number,end:number,name:(string|null),kind:string,meta:object}>}
 */
export function smartChunk({
  text,
  ext,
  relPath = null,
  mode,
  context = {}
}) {
  const limitContext = buildLimitContext(context, relPath, ext, mode);
  if (mode === 'prose') {
    const chunker = resolveChunker(PROSE_CHUNKERS, ext, relPath);
    if (chunker) {
      const chunks = chunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return applyChunkingLimits(chunks, text, limitContext);
    }
    return applyChunkingLimits(chunkLargeProseFallback(text, context), text, limitContext);
  }
  if (mode === 'code') {
    const codeChunker = resolveChunker(CODE_CHUNKERS, ext, relPath);
    if (codeChunker) {
      const chunks = codeChunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return applyChunkingLimits(chunks, text, limitContext);
    }
    const formatChunker = resolveChunker(CODE_FORMAT_CHUNKERS, ext, relPath);
    if (formatChunker) {
      const chunks = formatChunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return applyChunkingLimits(chunks, text, limitContext);
    }
  }
  const fallbackChunkSize = 800;
  const fallbackKind = mode === 'code' ? 'Module' : 'Section';
  const out = [];
  for (let off = 0; off < text.length;) {
    const end = unicodeScalarBoundary(text, off, off + fallbackChunkSize);
    out.push({ start: off, end, name: null, kind: fallbackKind, meta: {} });
    off = end;
  }
  return applyChunkingLimits(out, text, limitContext);
}
