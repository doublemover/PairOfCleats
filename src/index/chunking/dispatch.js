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
import { buildJsChunks } from '../../lang/javascript.js';
import { buildTypeScriptChunks } from '../../lang/typescript.js';
import { buildCSharpChunks } from '../../lang/csharp.js';
import { buildKotlinChunks } from '../../lang/kotlin.js';
import { buildRubyChunks } from '../../lang/ruby.js';
import { buildPhpChunks } from '../../lang/php.js';
import { buildHtmlChunks } from '../../lang/html.js';
import { buildCssChunks } from '../../lang/css.js';
import { buildLuaChunks } from '../../lang/lua.js';
import { buildSqlChunks } from '../../lang/sql.js';
import { buildCLikeChunks } from '../../lang/clike.js';
import { buildPythonChunksFromAst, buildPythonHeuristicChunks } from '../../lang/python.js';
import { buildRustChunks } from '../../lang/rust.js';
import { buildSwiftChunks } from '../../lang/swift.js';
import { buildGoChunks } from '../../lang/go.js';
import { buildJavaChunks } from '../../lang/java.js';
import { buildPerlChunks } from '../../lang/perl.js';
import { buildShellChunks } from '../../lang/shell.js';
import { chunkIniToml } from './formats/ini-toml.js';
import { chunkJson } from './formats/json.js';
import { chunkDocxDocument } from './formats/docx.js';
import { chunkMarkdown } from './formats/markdown.js';
import { chunkPdfDocument } from './formats/pdf.js';
import { chunkRst, chunkAsciiDoc } from './formats/rst-asciidoc.js';
import { chunkXml } from './formats/xml.js';
import { chunkYaml } from './formats/yaml.js';
import { applyChunkingLimits } from './limits.js';
import { getTreeSitterOptions } from './tree-sitter.js';
import {
  buildLimitContext,
  chunkLargeProseFallback,
  resolveChunker,
  tryTreeSitterChunks
} from './dispatch/shared.js';
import {
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
} from './dispatch/heuristic-chunkers.js';
import { chunkGraphql, chunkProto } from './dispatch/schema-chunkers.js';

const INI_LIKE_EXTS = new Set(['.toml', '.ini', '.cfg', '.conf']);

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
    chunk: ({ text, context }) => context?.cssChunks || buildCssChunks(text, getTreeSitterOptions(context))
  },
  {
    id: 'python',
    match: (ext) => ext === '.py',
    chunk: ({ text, context }) => {
      const astChunks = buildPythonChunksFromAst(text, context?.pythonAst || null);
      if (astChunks && astChunks.length) return astChunks;
      if (context?.pythonTreeChunks && context.pythonTreeChunks.length) {
        return context.pythonTreeChunks;
      }
      return buildPythonHeuristicChunks(text);
    }
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
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'proto', context) || chunkProto(text, context)
  },
  {
    id: 'graphql',
    match: (ext) => ext === '.graphql' || ext === '.gql' || ext === '.graphqls',
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'graphql', context) || chunkGraphql(text, context)
  },
  { id: 'cmake', match: (ext) => CMAKE_EXTS.has(ext), chunk: ({ text, context }) => chunkCmake(text, context) },
  { id: 'starlark', match: (ext) => STARLARK_EXTS.has(ext), chunk: ({ text, context }) => chunkStarlark(text, context) },
  { id: 'nix', match: (ext) => NIX_EXTS.has(ext), chunk: ({ text, context }) => chunkNix(text, context) },
  {
    id: 'dart',
    match: (ext) => DART_EXTS.has(ext),
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'dart', context) || chunkDart(text, context)
  },
  {
    id: 'scala',
    match: (ext) => SCALA_EXTS.has(ext),
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'scala', context) || chunkScala(text, context)
  },
  {
    id: 'groovy',
    match: (ext) => GROOVY_EXTS.has(ext),
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'groovy', context) || chunkGroovy(text, context)
  },
  {
    id: 'r',
    match: (ext) => R_EXTS.has(ext),
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'r', context) || chunkR(text, context)
  },
  {
    id: 'julia',
    match: (ext) => JULIA_EXTS.has(ext),
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'julia', context) || chunkJulia(text, context)
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
    chunk: ({ text, context }) => chunkJinja(text, context)
  },
  {
    id: 'razor',
    match: (ext) => RAZOR_EXTS.has(ext),
    chunk: ({ text, context }) => chunkRazor(text, context)
  }
];

const CODE_FORMAT_CHUNKERS = [
  { id: 'json', match: (ext) => ext === '.json', chunk: ({ text, context }) => chunkJson(text, context) },
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
    chunk: ({ text, context }) => tryTreeSitterChunks(text, 'graphql', context) || chunkGraphql(text, context)
  }
];

const PROSE_CHUNKERS = [
  { id: 'pdf', match: (ext) => ext === '.pdf', chunk: ({ text, context }) => chunkPdfDocument(text, context) },
  { id: 'docx', match: (ext) => ext === '.docx', chunk: ({ text, context }) => chunkDocxDocument(text, context) },
  {
    id: 'markdown',
    match: (ext) => ext === '.md' || ext === '.mdx',
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
 * Build chunks for a single file using language-aware heuristics.
 * Falls back to generic fixed-size chunks when no parser matches.
 * @param {object} params
 * @param {string} params.text
 * @param {string} params.ext
 * @param {string|null} [params.relPath]
 * @param {'code'|'prose'} params.mode
 * @param {object} [params.context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>}
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
  const out = new Array(Math.ceil(text.length / fallbackChunkSize));
  for (let i = 0, off = 0; off < text.length; off += fallbackChunkSize, i += 1) {
    out[i] = {
      start: off,
      end: Math.min(text.length, off + fallbackChunkSize),
      name: null,
      kind: fallbackKind,
      meta: {}
    };
  }
  return applyChunkingLimits(out, text, limitContext);
}
