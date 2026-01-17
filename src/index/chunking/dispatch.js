import {
  EXTS_PROSE,
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
import { buildLineIndex } from '../../shared/lines.js';
import { chunkIniToml } from './formats/ini-toml.js';
import { chunkJson } from './formats/json.js';
import { chunkMarkdown } from './formats/markdown.js';
import { chunkRst, chunkAsciiDoc } from './formats/rst-asciidoc.js';
import { chunkXml } from './formats/xml.js';
import { chunkYaml } from './formats/yaml.js';
import { applyChunkingLimits } from './limits.js';
import { getTreeSitterOptions } from './tree-sitter.js';

const buildChunksFromLineHeadings = (text, headings) => {
  if (!headings.length) return null;
  const lineIndex = buildLineIndex(text);
  const chunks = [];
  for (let i = 0; i < headings.length; ++i) {
    const startLine = headings[i].line;
    const endLine = i + 1 < headings.length ? headings[i + 1].line : lineIndex.length;
    const start = lineIndex[startLine] || 0;
    const end = endLine < lineIndex.length ? lineIndex[endLine] : text.length;
    const title = headings[i].title || 'section';
    chunks.push({
      start,
      end,
      name: title,
      kind: 'Section',
      meta: { title }
    });
  }
  return chunks;
};

const applyFormatMeta = (chunks, format, kind) => {
  if (!chunks) return null;
  return chunks.map((chunk) => ({
    ...chunk,
    kind: kind || chunk.kind,
    meta: format ? { ...(chunk.meta || {}), format } : chunk.meta
  }));
};

const MAX_REGEX_LINE = 8192;

const chunkByLineRegex = (text, matcher, options = {}) => {
  const lines = text.split('\n');
  const headings = [];
  const maxLineLength = Number.isFinite(Number(options.maxLineLength))
    ? Math.max(0, Math.floor(Number(options.maxLineLength)))
    : MAX_REGEX_LINE;
  const skipLine = typeof options.skipLine === 'function' ? options.skipLine : null;
  const precheck = typeof options.precheck === 'function' ? options.precheck : null;
  const titleFor = typeof options.title === 'function' ? options.title : null;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (maxLineLength && line.length > maxLineLength) continue;
    if (skipLine && skipLine(line)) continue;
    if (precheck && !precheck(line)) continue;
    const match = line.match(matcher);
    if (!match) continue;
    const title = titleFor ? titleFor(match, line) : (match[1] || '').trim();
    if (!title) continue;
    headings.push({ line: i, title });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) {
    return applyFormatMeta(chunks, options.format || null, options.kind || null);
  }
  return [{
    start: 0,
    end: text.length,
    name: options.defaultName || 'section',
    kind: options.kind || 'Section',
    meta: options.format ? { format: options.format } : {}
  }];
};

const chunkDockerfile = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*([A-Z][A-Z0-9_-]+)\b/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (!line || (line[0] < 'A' || line[0] > 'Z')) continue;
    const match = line.match(rx);
    if (match) headings.push({ line: i, title: match[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) {
    return applyFormatMeta(chunks, 'dockerfile', 'ConfigSection');
  }
  return [{ start: 0, end: text.length, name: 'Dockerfile', kind: 'ConfigSection', meta: { format: 'dockerfile' } }];
};

const chunkMakefile = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^([A-Za-z0-9_./-]+)\s*:/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (line.trim().startsWith('#') || !line.trim()) continue;
    if (!line.includes(':')) continue;
    const match = line.match(rx);
    if (match) headings.push({ line: i, title: match[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) {
    return applyFormatMeta(chunks, 'makefile', 'ConfigSection');
  }
  return [{ start: 0, end: text.length, name: 'Makefile', kind: 'ConfigSection', meta: { format: 'makefile' } }];
};

const chunkProto = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*(message|enum|service|extend|oneof)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (!(line.includes('message')
      || line.includes('enum')
      || line.includes('service')
      || line.includes('extend')
      || line.includes('oneof'))) {
      continue;
    }
    const match = line.match(rx);
    if (match) {
      const kind = match[1];
      const name = match[2];
      headings.push({ line: i, title: `${kind} ${name}`.trim() });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'proto', kind: 'Section', meta: { format: 'proto' } }];
};

const chunkGraphql = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*(schema|type|interface|enum|union|input|scalar|directive|fragment)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (!(line.includes('schema')
      || line.includes('type')
      || line.includes('interface')
      || line.includes('enum')
      || line.includes('union')
      || line.includes('input')
      || line.includes('scalar')
      || line.includes('directive')
      || line.includes('fragment'))) {
      continue;
    }
    const match = line.match(rx);
    if (match) {
      const kind = match[1];
      const name = match[2] || '';
      const title = name ? `${kind} ${name}` : kind;
      headings.push({ line: i, title });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  return chunks || [{ start: 0, end: text.length, name: 'graphql', kind: 'Section', meta: { format: 'graphql' } }];
};

const chunkCmake = (text) => chunkByLineRegex(text, /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/, {
  format: 'cmake',
  kind: 'ConfigSection',
  defaultName: 'cmake',
  skipLine: (line) => line.trim().startsWith('#'),
  precheck: (line) => line.includes('(')
});

const chunkStarlark = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const defRx = /^\s*(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
  const callRx = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (line.trim().startsWith('#')) continue;
    if (!(line.includes('def') || line.includes('class') || line.includes('('))) {
      continue;
    }
    const defMatch = line.match(defRx);
    if (defMatch) {
      headings.push({ line: i, title: `${defMatch[1]} ${defMatch[2]}` });
      continue;
    }
    const callMatch = line.match(callRx);
    if (callMatch) headings.push({ line: i, title: callMatch[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'starlark', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'starlark',
    kind: 'Section',
    meta: { format: 'starlark' }
  }];
};

const chunkNix = (text) => {
  const skipLine = (line) => {
    const trimmed = line.trim();
    return !trimmed || trimmed.startsWith('#') || trimmed === 'in' || trimmed === 'let';
  };
    return chunkByLineRegex(text, /^\s*([A-Za-z0-9_.-]+)\s*=/, {
      format: 'nix',
      kind: 'Section',
      defaultName: 'nix',
      skipLine,
      precheck: (line) => line.includes('=')
    });
  };

const chunkDart = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const typeRx = /^\s*(class|mixin|enum|extension|typedef)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const funcRx = /^\s*(?:[A-Za-z_][A-Za-z0-9_<>]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  const skipNames = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new']);
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (line.trim().startsWith('//')) continue;
    if (!(line.includes('class')
      || line.includes('mixin')
      || line.includes('enum')
      || line.includes('extension')
      || line.includes('typedef')
      || line.includes('('))) {
      continue;
    }
    const typeMatch = line.match(typeRx);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[2] });
      continue;
    }
    const funcMatch = line.match(funcRx);
    if (funcMatch && !skipNames.has(funcMatch[1])) {
      headings.push({ line: i, title: funcMatch[1] });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'dart', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'dart',
    kind: 'Section',
    meta: { format: 'dart' }
  }];
};

const chunkScala = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const typeRx = /^\s*(?:case\s+class|class|object|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const defRx = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (line.trim().startsWith('//')) continue;
    if (!(line.includes('class')
      || line.includes('object')
      || line.includes('trait')
      || line.includes('enum')
      || line.includes('def'))) {
      continue;
    }
    const typeMatch = line.match(typeRx);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[1] });
      continue;
    }
    const defMatch = line.match(defRx);
    if (defMatch) headings.push({ line: i, title: defMatch[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'scala', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'scala',
    kind: 'Section',
    meta: { format: 'scala' }
  }];
};

const chunkGroovy = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const typeRx = /^\s*(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const defRx = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (line.trim().startsWith('//')) continue;
    if (!(line.includes('class')
      || line.includes('interface')
      || line.includes('trait')
      || line.includes('enum')
      || line.includes('def'))) {
      continue;
    }
    const typeMatch = line.match(typeRx);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[2] });
      continue;
    }
    const defMatch = line.match(defRx);
    if (defMatch) headings.push({ line: i, title: defMatch[1] });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'groovy', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'groovy',
    kind: 'Section',
    meta: { format: 'groovy' }
  }];
};

const chunkR = (text) => chunkByLineRegex(text, /^\s*([A-Za-z.][A-Za-z0-9_.]*)\s*(?:<-|=)\s*function\b/, {
  format: 'r',
  kind: 'Section',
  defaultName: 'r',
  precheck: (line) => line.includes('function')
});

const chunkJulia = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*(module|function|macro)\s+([A-Za-z_][A-Za-z0-9_!.]*)/;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.trim().startsWith('#')) continue;
    if (line.length > 8192) continue;
    if (!(line.includes('module') || line.includes('function') || line.includes('macro'))) {
      continue;
    }
    const match = line.match(rx);
    if (match) {
      headings.push({ line: i, title: match[2] });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'julia', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'julia',
    kind: 'Section',
    meta: { format: 'julia' }
  }];
};

const chunkHandlebars = (text) => chunkByLineRegex(text, /{{[#^]\s*([A-Za-z0-9_.-]+)\b/, {
  format: 'handlebars',
  kind: 'Section',
  defaultName: 'handlebars',
  precheck: (line) => line.includes('{{')
});

const chunkMustache = (text) => chunkByLineRegex(text, /{{[#^]\s*([A-Za-z0-9_.-]+)\b/, {
  format: 'mustache',
  kind: 'Section',
  defaultName: 'mustache',
  precheck: (line) => line.includes('{{')
});

const chunkJinja = (text) => chunkByLineRegex(text, /{%\s*(block|macro|for|if|set|include|extends)\s+([^%\n]+)%}/, {
  format: 'jinja',
  kind: 'Section',
  defaultName: 'jinja',
  precheck: (line) => line.includes('{%'),
  title: (match) => {
    const name = String(match[2] || '').trim().split(/\s+/)[0];
    return name ? `${match[1]} ${name}` : match[1];
  }
});

const chunkRazor = (text) => {
  const lines = text.split('\n');
  const headings = [];
  const rx = /^\s*@\s*(page|model|inherits|functions|code|section)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/i;
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (!line.includes('@')) continue;
    const match = line.match(rx);
    if (!match) continue;
    const name = match[2] ? `${match[1]} ${match[2]}` : match[1];
    headings.push({ line: i, title: name });
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'razor', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'razor',
    kind: 'Section',
    meta: { format: 'razor' }
  }];
};

const CODE_CHUNKERS = [
  { id: 'javascript', match: (ext) => isJsLike(ext), chunk: ({ text, ext, context }) => {
    if (context?.jsChunks) return context.jsChunks;
    return buildJsChunks(text, {
      ext,
      ast: context?.jsAst,
      javascript: context?.javascript,
      flowMode: context?.javascript?.flow,
      treeSitter: context?.treeSitter,
      log: context?.log
    });
  } },
  { id: 'typescript', match: (ext) => isTypeScript(ext), chunk: ({ text, ext, relPath, context }) => {
    if (context?.tsChunks) return context.tsChunks;
    const parser = context?.typescript?.importsOnly ? 'heuristic' : context?.typescript?.parser;
    return buildTypeScriptChunks(text, {
      ext,
      relPath,
      parser,
      treeSitter: context?.treeSitter,
      log: context?.log
    });
  } },
  { id: 'html', match: (ext) => isHtml(ext), chunk: ({ text, context }) =>
    context?.htmlChunks || buildHtmlChunks(text, getTreeSitterOptions(context)) },
  { id: 'css', match: (ext) => isCss(ext), chunk: ({ text, context }) =>
    context?.cssChunks || buildCssChunks(text, getTreeSitterOptions(context)) },
  { id: 'python', match: (ext) => ext === '.py', chunk: ({ text, context }) => {
    const astChunks = buildPythonChunksFromAst(text, context?.pythonAst || null);
    if (astChunks && astChunks.length) return astChunks;
    if (context?.pythonTreeChunks && context.pythonTreeChunks.length) {
      return context.pythonTreeChunks;
    }
    return buildPythonHeuristicChunks(text);
  } },
  { id: 'swift', match: (ext) => ext === '.swift', chunk: ({ text, context }) =>
    context?.swiftChunks || buildSwiftChunks(text, getTreeSitterOptions(context)) },
  { id: 'clike', match: (ext) => isCLike(ext), chunk: ({ text, ext, context }) =>
    context?.clikeChunks || buildCLikeChunks(text, ext, getTreeSitterOptions(context)) },
  { id: 'rust', match: (ext) => isRust(ext), chunk: ({ text, context }) =>
    context?.rustChunks || buildRustChunks(text, getTreeSitterOptions(context)) },
  { id: 'go', match: (ext) => isGo(ext), chunk: ({ text, context }) =>
    context?.goChunks || buildGoChunks(text, getTreeSitterOptions(context)) },
  { id: 'java', match: (ext) => isJava(ext), chunk: ({ text, context }) =>
    context?.javaChunks || buildJavaChunks(text, getTreeSitterOptions(context)) },
  { id: 'perl', match: (ext) => isPerl(ext), chunk: ({ text, context }) =>      
    context?.perlChunks || buildPerlChunks(text) },
  { id: 'shell', match: (ext) => isShell(ext), chunk: ({ text, context }) =>    
    context?.shellChunks || buildShellChunks(text) },
  { id: 'dockerfile', match: (ext) => ext === '.dockerfile', chunk: ({ text }) =>
    chunkDockerfile(text) },
  { id: 'makefile', match: (ext) => ext === '.makefile', chunk: ({ text }) =>
    chunkMakefile(text) },
  { id: 'csharp', match: (ext) => isCSharp(ext), chunk: ({ text, context }) =>  
    context?.csharpChunks || buildCSharpChunks(text, getTreeSitterOptions(context)) },
  { id: 'kotlin', match: (ext) => isKotlin(ext), chunk: ({ text, context }) =>
    context?.kotlinChunks || buildKotlinChunks(text, getTreeSitterOptions(context)) },
  { id: 'ruby', match: (ext) => isRuby(ext), chunk: ({ text, context }) =>
    context?.rubyChunks || buildRubyChunks(text) },
  { id: 'php', match: (ext) => isPhp(ext), chunk: ({ text, context }) =>
    context?.phpChunks || buildPhpChunks(text) },
  { id: 'lua', match: (ext) => isLua(ext), chunk: ({ text, context }) =>
    context?.luaChunks || buildLuaChunks(text) },
  { id: 'sql', match: (ext) => isSql(ext), chunk: ({ text, context }) =>
    context?.sqlChunks || buildSqlChunks(text) },
  { id: 'cmake', match: (ext) => CMAKE_EXTS.has(ext), chunk: ({ text }) => chunkCmake(text) },
  { id: 'starlark', match: (ext) => STARLARK_EXTS.has(ext), chunk: ({ text }) => chunkStarlark(text) },
  { id: 'nix', match: (ext) => NIX_EXTS.has(ext), chunk: ({ text }) => chunkNix(text) },
  { id: 'dart', match: (ext) => DART_EXTS.has(ext), chunk: ({ text }) => chunkDart(text) },
  { id: 'scala', match: (ext) => SCALA_EXTS.has(ext), chunk: ({ text }) => chunkScala(text) },
  { id: 'groovy', match: (ext) => GROOVY_EXTS.has(ext), chunk: ({ text }) => chunkGroovy(text) },
  { id: 'r', match: (ext) => R_EXTS.has(ext), chunk: ({ text }) => chunkR(text) },
  { id: 'julia', match: (ext) => JULIA_EXTS.has(ext), chunk: ({ text }) => chunkJulia(text) },
  { id: 'handlebars', match: (ext) => HANDLEBARS_EXTS.has(ext), chunk: ({ text }) => chunkHandlebars(text) },
  { id: 'mustache', match: (ext) => MUSTACHE_EXTS.has(ext), chunk: ({ text }) => chunkMustache(text) },
  { id: 'jinja', match: (ext) => JINJA_EXTS.has(ext), chunk: ({ text }) => chunkJinja(text) },
  { id: 'razor', match: (ext) => RAZOR_EXTS.has(ext), chunk: ({ text }) => chunkRazor(text) }
];

const CODE_FORMAT_CHUNKERS = [
  { id: 'json', match: (ext) => ext === '.json', chunk: ({ text, context }) => chunkJson(text, context) },
  { id: 'ini', match: (ext) => ['.toml', '.ini', '.cfg', '.conf'].includes(ext), chunk: ({ text, ext, context }) =>
    chunkIniToml(text, ext === '.toml' ? 'toml' : 'ini', context) },
  { id: 'xml', match: (ext) => ext === '.xml', chunk: ({ text }) => chunkXml(text) },
  { id: 'yaml', match: (ext) => ext === '.yaml' || ext === '.yml', chunk: ({ text, relPath, context }) => chunkYaml(text, relPath, context) }
];

const PROSE_CHUNKERS = [
  { id: 'markdown', match: (ext) => ext === '.md' || ext === '.mdx', chunk: ({ text, ext, context }) => chunkMarkdown(text, ext, context) },
  { id: 'rst', match: (ext) => ext === '.rst', chunk: ({ text }) => chunkRst(text) },
  { id: 'asciidoc', match: (ext) => ext === '.adoc' || ext === '.asciidoc', chunk: ({ text }) => chunkAsciiDoc(text) }
];

const resolveChunker = (chunkers, ext, relPath) => (
  chunkers.find((entry) => entry.match(ext, relPath)) || null
);

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
  if (mode === 'prose') {
    const chunker = resolveChunker(PROSE_CHUNKERS, ext, relPath);
    if (chunker) {
      const chunks = chunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return applyChunkingLimits(chunks, text, context);
    }
  }
  if (mode === 'code') {
    const codeChunker = resolveChunker(CODE_CHUNKERS, ext, relPath);
    if (codeChunker) {
      const chunks = codeChunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return applyChunkingLimits(chunks, text, context);
    }
    const formatChunker = resolveChunker(CODE_FORMAT_CHUNKERS, ext, relPath);
    if (formatChunker) {
      const chunks = formatChunker.chunk({ text, ext, relPath, context });
      if (chunks && chunks.length) return applyChunkingLimits(chunks, text, context);
    }
  }
  if (mode === 'prose' && EXTS_PROSE.has(ext)) {
    return applyChunkingLimits(
      [{ start: 0, end: text.length, name: 'root', kind: 'Section', meta: {} }],
      text,
      context
    );
  }
  const fallbackChunkSize = 800;
  const out = [];
  for (let off = 0; off < text.length; off += fallbackChunkSize) {
    out.push({
      start: off,
      end: Math.min(text.length, off + fallbackChunkSize),
      name: 'blob',
      kind: 'Blob',
      meta: {}
    });
  }
  return applyChunkingLimits(out, text, context);
}
