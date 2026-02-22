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
import { buildTreeSitterChunks } from '../../lang/tree-sitter.js';
import { chunkIniToml } from './formats/ini-toml.js';
import { chunkJson } from './formats/json.js';
import { chunkDocxDocument } from './formats/docx.js';
import { chunkMarkdown } from './formats/markdown.js';
import { chunkPdfDocument } from './formats/pdf.js';
import { chunkRst, chunkAsciiDoc } from './formats/rst-asciidoc.js';
import { chunkXml } from './formats/xml.js';
import { chunkYaml } from './formats/yaml.js';
import { buildChunksFromLineHeadings, buildLineIndexFromLines } from './helpers.js';
import { applyChunkingLimits } from './limits.js';
import { getTreeSitterOptions } from './tree-sitter.js';
import { parseDockerfileFromClause, parseDockerfileInstruction } from '../../shared/dockerfile.js';

const applyFormatMeta = (chunks, format, kind) => {
  if (!chunks) return null;
  return chunks.map((chunk) => ({
    ...chunk,
    kind: kind || chunk.kind,
    meta: format ? { ...(chunk.meta || {}), format } : chunk.meta
  }));
};

const MAX_REGEX_LINE = 8192;
const DEFAULT_PROSE_FALLBACK_MAX_CHARS = 120 * 1024;
const DEFAULT_PROSE_FALLBACK_CHUNK_CHARS = 24 * 1024;

const splitLinesWithIndex = (text, context = null) => {
  const lines = text.split('\n');
  const sharedLineIndex = Array.isArray(context?.chunkingShared?.lineIndex)
    ? context.chunkingShared.lineIndex
    : null;
  if (sharedLineIndex && sharedLineIndex.length === lines.length) {
    return { lines, lineIndex: sharedLineIndex };
  }
  const lineIndex = buildLineIndexFromLines(lines);
  if (context?.chunkingShared && typeof context.chunkingShared === 'object') {
    context.chunkingShared.lineIndex = lineIndex;
  }
  return {
    lines,
    lineIndex
  };
};

const chunkByLineRegex = (text, matcher, options = {}, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
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
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
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

const chunkDockerfile = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const parsed = parseDockerfileInstruction(line);
    if (!parsed) continue;
    if (parsed.instruction === 'FROM') {
      const from = parseDockerfileFromClause(line);
      const fromTarget = from?.stage || from?.image || 'FROM';
      headings.push({ line: i, title: `FROM ${fromTarget}` });
      continue;
    }
    headings.push({ line: i, title: parsed.instruction });
  }
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return applyFormatMeta(chunks, 'dockerfile', 'ConfigSection');
  }
  return [{ start: 0, end: text.length, name: 'Dockerfile', kind: 'ConfigSection', meta: { format: 'dockerfile' } }];
};

const chunkMakefile = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
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
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return applyFormatMeta(chunks, 'makefile', 'ConfigSection');
  }
  return [{ start: 0, end: text.length, name: 'Makefile', kind: 'ConfigSection', meta: { format: 'makefile' } }];
};

const chunkProto = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  const blockRx = /^\s*(message|enum|service|oneof)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  // `extend` targets may be fully qualified (for example
  // `extend google.protobuf.MessageOptions`), so allow dotted paths and an
  // optional leading dot for package-qualified symbols.
  const extendRx = /^\s*extend\s+(\.?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/;
  const rpcRx = /^\s*rpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
  const syntaxRx = /^\s*syntax\s*=\s*["'][^"']+["']\s*;/;
  const packageRx = /^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/;
  const kindByKeyword = {
    message: 'TypeDeclaration',
    enum: 'EnumDeclaration',
    service: 'ServiceDeclaration',
    extend: 'ExtendDeclaration',
    oneof: 'OneOfDeclaration'
  };
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (line.trim().startsWith('//')) continue;
    if (syntaxRx.test(line)) {
      headings.push({ line: i, title: 'syntax', kind: 'ConfigDeclaration', definitionType: 'syntax' });
      continue;
    }
    const packageMatch = line.match(packageRx);
    if (packageMatch) {
      headings.push({
        line: i,
        title: `package ${packageMatch[1]}`,
        kind: 'NamespaceDeclaration',
        definitionType: 'package'
      });
      continue;
    }
    if (!(line.includes('message')
      || line.includes('enum')
      || line.includes('service')
      || line.includes('extend')
      || line.includes('oneof')
      || line.includes('rpc'))) {
      continue;
    }
    const rpcMatch = line.match(rpcRx);
    if (rpcMatch) {
      headings.push({
        line: i,
        title: `rpc ${rpcMatch[1]}`,
        kind: 'MethodDeclaration',
        definitionType: 'rpc'
      });
      continue;
    }
    const extendMatch = line.match(extendRx);
    if (extendMatch) {
      const name = extendMatch[1];
      headings.push({
        line: i,
        title: `extend ${name}`,
        kind: 'ExtendDeclaration',
        definitionType: 'extend'
      });
      continue;
    }
    const blockMatch = line.match(blockRx);
    if (blockMatch) {
      const keyword = blockMatch[1];
      const name = blockMatch[2];
      headings.push({
        line: i,
        title: `${keyword} ${name}`.trim(),
        kind: kindByKeyword[keyword] || 'Section',
        definitionType: keyword
      });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return chunks.map((chunk, index) => ({
      ...chunk,
      kind: headings[index]?.kind || 'Section',
      meta: {
        ...(chunk.meta || {}),
        format: 'proto',
        definitionType: headings[index]?.definitionType || null
      }
    }));
  }
  return [{ start: 0, end: text.length, name: 'proto', kind: 'Section', meta: { format: 'proto' } }];
};

const chunkGraphql = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  const blockRx = /^\s*(schema|type|interface|enum|union|input|scalar|directive|fragment)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/;
  const operationRx = /^\s*(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  // GraphQL allows both `extend type Name` and `extend schema { ... }` with
  // no schema identifier.
  const extendRx = /^\s*extend\s+(schema|type|interface|enum|union|input|scalar)\b(?:\s+([A-Za-z_][A-Za-z0-9_]*))?/;
  const kindByKeyword = {
    schema: 'SchemaDeclaration',
    type: 'TypeDeclaration',
    interface: 'InterfaceDeclaration',
    enum: 'EnumDeclaration',
    union: 'UnionDeclaration',
    input: 'InputDeclaration',
    scalar: 'ScalarDeclaration',
    directive: 'DirectiveDeclaration',
    fragment: 'FragmentDeclaration',
    query: 'OperationDeclaration',
    mutation: 'OperationDeclaration',
    subscription: 'OperationDeclaration'
  };
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (line.trim().startsWith('#')) continue;
    if (!(line.includes('schema')
      || line.includes('type')
      || line.includes('interface')
      || line.includes('enum')
      || line.includes('union')
      || line.includes('input')
      || line.includes('scalar')
      || line.includes('directive')
      || line.includes('fragment')
      || line.includes('query')
      || line.includes('mutation')
      || line.includes('subscription')
      || line.includes('extend'))) {
      continue;
    }
    const extendMatch = line.match(extendRx);
    if (extendMatch) {
      const definitionType = `extend-${extendMatch[1]}`;
      const title = extendMatch[2]
        ? `extend ${extendMatch[1]} ${extendMatch[2]}`
        : `extend ${extendMatch[1]}`;
      headings.push({
        line: i,
        title,
        kind: kindByKeyword[extendMatch[1]] || 'Section',
        definitionType
      });
      continue;
    }
    const operationMatch = line.match(operationRx);
    if (operationMatch) {
      const definitionType = operationMatch[1];
      const title = `${definitionType} ${operationMatch[2]}`;
      headings.push({
        line: i,
        title,
        kind: kindByKeyword[definitionType] || 'Section',
        definitionType
      });
      continue;
    }
    const blockMatch = line.match(blockRx);
    if (blockMatch) {
      const definitionType = blockMatch[1];
      const name = blockMatch[2] || '';
      const title = name ? `${definitionType} ${name}` : definitionType;
      headings.push({
        line: i,
        title,
        kind: kindByKeyword[definitionType] || 'Section',
        definitionType
      });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return chunks.map((chunk, index) => ({
      ...chunk,
      kind: headings[index]?.kind || 'Section',
      meta: {
        ...(chunk.meta || {}),
        format: 'graphql',
        definitionType: headings[index]?.definitionType || null
      }
    }));
  }
  return [{ start: 0, end: text.length, name: 'graphql', kind: 'Section', meta: { format: 'graphql' } }];
};

const chunkCmake = (text, context = null) => chunkByLineRegex(text, /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/, {
  format: 'cmake',
  kind: 'ConfigSection',
  defaultName: 'cmake',
  skipLine: (line) => line.trim().startsWith('#'),
  precheck: (line) => line.includes('(')
}, context);

const chunkStarlark = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
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
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'starlark', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'starlark',
    kind: 'Section',
    meta: { format: 'starlark' }
  }];
};

const chunkNix = (text, context = null) => {
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
  }, context);
};

const chunkDart = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
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
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'dart', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'dart',
    kind: 'Section',
    meta: { format: 'dart' }
  }];
};

const chunkScala = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
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
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'scala', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'scala',
    kind: 'Section',
    meta: { format: 'scala' }
  }];
};

const chunkGroovy = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
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
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'groovy', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'groovy',
    kind: 'Section',
    meta: { format: 'groovy' }
  }];
};

const chunkR = (text, context = null) => chunkByLineRegex(text, /^\s*([A-Za-z.][A-Za-z0-9_.]*)\s*(?:<-|=)\s*function\b/, {
  format: 'r',
  kind: 'Section',
  defaultName: 'r',
  precheck: (line) => line.includes('function')
}, context);

const chunkJulia = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
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
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'julia', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'julia',
    kind: 'Section',
    meta: { format: 'julia' }
  }];
};

const chunkHandlebars = (text, context = null) => chunkByLineRegex(text, /{{[#^]\s*([A-Za-z0-9_.-]+)\b/, {
  format: 'handlebars',
  kind: 'Section',
  defaultName: 'handlebars',
  precheck: (line) => line.includes('{{')
}, context);

const chunkMustache = (text, context = null) => chunkByLineRegex(text, /{{[#^]\s*([A-Za-z0-9_.-]+)\b/, {
  format: 'mustache',
  kind: 'Section',
  defaultName: 'mustache',
  precheck: (line) => line.includes('{{')
}, context);

const chunkJinja = (text, context = null) => chunkByLineRegex(text, /{%\s*(block|macro|for|if|set|include|extends)\s+([^%\n]+)%}/, {
  format: 'jinja',
  kind: 'Section',
  defaultName: 'jinja',
  precheck: (line) => line.includes('{%'),
  title: (match) => {
    const name = String(match[2] || '').trim().split(/\s+/)[0];
    return name ? `${match[1]} ${name}` : match[1];
  }
}, context);

const chunkRazor = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
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
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) return applyFormatMeta(chunks, 'razor', 'Section');
  return [{
    start: 0,
    end: text.length,
    name: 'razor',
    kind: 'Section',
    meta: { format: 'razor' }
  }];
};

const tryTreeSitterChunks = (text, languageId, context) => {
  // Keep fallback deterministic: only short-circuit when tree-sitter produced
  // concrete chunks for this language; otherwise continue with heuristics.
  const chunks = buildTreeSitterChunks({
    text,
    languageId,
    options: getTreeSitterOptions(context)
  });
  return (Array.isArray(chunks) && chunks.length) ? chunks : null;
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
    context?.perlChunks || buildPerlChunks(text, getTreeSitterOptions(context)) },
  { id: 'shell', match: (ext) => isShell(ext), chunk: ({ text, context }) =>    
    context?.shellChunks || buildShellChunks(text, getTreeSitterOptions(context)) },
  { id: 'dockerfile', match: (ext) => ext === '.dockerfile', chunk: ({ text, context }) =>
    chunkDockerfile(text, context) },
  { id: 'makefile', match: (ext) => ext === '.makefile', chunk: ({ text, context }) =>
    chunkMakefile(text, context) },
  { id: 'csharp', match: (ext) => isCSharp(ext), chunk: ({ text, context }) =>  
    context?.csharpChunks || buildCSharpChunks(text, getTreeSitterOptions(context)) },
  { id: 'kotlin', match: (ext) => isKotlin(ext), chunk: ({ text, context }) =>
    context?.kotlinChunks || buildKotlinChunks(text, getTreeSitterOptions(context)) },
  { id: 'ruby', match: (ext) => isRuby(ext), chunk: ({ text, context }) =>
    context?.rubyChunks || buildRubyChunks(text, getTreeSitterOptions(context)) },
  { id: 'php', match: (ext) => isPhp(ext), chunk: ({ text, context }) =>
    context?.phpChunks || buildPhpChunks(text, getTreeSitterOptions(context)) },
  { id: 'lua', match: (ext) => isLua(ext), chunk: ({ text, context }) =>
    context?.luaChunks || buildLuaChunks(text, getTreeSitterOptions(context)) },
  { id: 'sql', match: (ext) => isSql(ext), chunk: ({ text, context }) =>
    context?.sqlChunks || buildSqlChunks(text, getTreeSitterOptions(context)) },
  { id: 'proto', match: (ext) => ext === '.proto', chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'proto', context) || chunkProto(text, context) },
  { id: 'graphql', match: (ext) => ext === '.graphql' || ext === '.gql' || ext === '.graphqls', chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'graphql', context) || chunkGraphql(text, context) },
  { id: 'cmake', match: (ext) => CMAKE_EXTS.has(ext), chunk: ({ text, context }) => chunkCmake(text, context) },
  { id: 'starlark', match: (ext) => STARLARK_EXTS.has(ext), chunk: ({ text, context }) => chunkStarlark(text, context) },
  { id: 'nix', match: (ext) => NIX_EXTS.has(ext), chunk: ({ text, context }) => chunkNix(text, context) },
  { id: 'dart', match: (ext) => DART_EXTS.has(ext), chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'dart', context) || chunkDart(text, context) },
  { id: 'scala', match: (ext) => SCALA_EXTS.has(ext), chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'scala', context) || chunkScala(text, context) },
  { id: 'groovy', match: (ext) => GROOVY_EXTS.has(ext), chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'groovy', context) || chunkGroovy(text, context) },
  { id: 'r', match: (ext) => R_EXTS.has(ext), chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'r', context) || chunkR(text, context) },
  { id: 'julia', match: (ext) => JULIA_EXTS.has(ext), chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'julia', context) || chunkJulia(text, context) },
  { id: 'handlebars', match: (ext) => HANDLEBARS_EXTS.has(ext), chunk: ({ text, context }) => chunkHandlebars(text, context) },
  { id: 'mustache', match: (ext) => MUSTACHE_EXTS.has(ext), chunk: ({ text, context }) => chunkMustache(text, context) },
  { id: 'jinja', match: (ext) => JINJA_EXTS.has(ext), chunk: ({ text, context }) => chunkJinja(text, context) },
  { id: 'razor', match: (ext) => RAZOR_EXTS.has(ext), chunk: ({ text, context }) => chunkRazor(text, context) }
];

const CODE_FORMAT_CHUNKERS = [
  { id: 'json', match: (ext) => ext === '.json', chunk: ({ text, context }) => chunkJson(text, context) },
  { id: 'ini', match: (ext) => ['.toml', '.ini', '.cfg', '.conf'].includes(ext), chunk: ({ text, ext, context }) =>
    chunkIniToml(text, ext === '.toml' ? 'toml' : 'ini', context) },
  { id: 'xml', match: (ext) => ext === '.xml', chunk: ({ text, context }) => chunkXml(text, context) },
  { id: 'yaml', match: (ext) => ext === '.yaml' || ext === '.yml', chunk: ({ text, relPath, context }) => chunkYaml(text, relPath, context) },
  { id: 'proto', match: (ext) => ext === '.proto', chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'proto', context) || chunkProto(text, context) },
  { id: 'graphql', match: (ext) => ext === '.graphql' || ext === '.gql', chunk: ({ text, context }) =>
    tryTreeSitterChunks(text, 'graphql', context) || chunkGraphql(text, context) }
];

const PROSE_CHUNKERS = [
  { id: 'pdf', match: (ext) => ext === '.pdf', chunk: ({ text, context }) => chunkPdfDocument(text, context) },
  { id: 'docx', match: (ext) => ext === '.docx', chunk: ({ text, context }) => chunkDocxDocument(text, context) },
  { id: 'markdown', match: (ext) => ext === '.md' || ext === '.mdx', chunk: ({ text, ext, context }) => chunkMarkdown(text, ext, context) },
  { id: 'rst', match: (ext) => ext === '.rst', chunk: ({ text }) => chunkRst(text) },
  { id: 'asciidoc', match: (ext) => ext === '.adoc' || ext === '.asciidoc', chunk: ({ text }) => chunkAsciiDoc(text) }
];

const resolveChunker = (chunkers, ext, relPath) => (
  chunkers.find((entry) => entry.match(ext, relPath)) || null
);

const chunkLargeProseFallback = (text, context = {}) => {
  if (!text) return [];
  const chunking = context?.chunking && typeof context.chunking === 'object'
    ? context.chunking
    : {};
  const maxCharsRaw = Number(chunking.proseFallbackMaxChars);
  const chunkCharsRaw = Number(chunking.proseFallbackChunkChars);
  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0
    ? Math.floor(maxCharsRaw)
    : DEFAULT_PROSE_FALLBACK_MAX_CHARS;
  const chunkChars = Number.isFinite(chunkCharsRaw) && chunkCharsRaw > 0
    ? Math.floor(chunkCharsRaw)
    : DEFAULT_PROSE_FALLBACK_CHUNK_CHARS;
  if (text.length <= maxChars || chunkChars <= 0) {
    return [{ start: 0, end: text.length, name: null, kind: 'Section', meta: {} }];
  }
  // Preserve full coverage while capping worst-case tokenization latency for
  // very large prose blobs that would otherwise become one giant chunk.
  const chunks = [];
  for (let start = 0; start < text.length; start += chunkChars) {
    const end = Math.min(text.length, start + chunkChars);
    chunks.push({ start, end, name: null, kind: 'Section', meta: {} });
  }
  return chunks;
};

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
    return applyChunkingLimits(chunkLargeProseFallback(text, context), text, context);
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
  const fallbackChunkSize = 800;
  const out = [];
  const fallbackKind = mode === 'code' ? 'Module' : 'Section';
  for (let off = 0; off < text.length; off += fallbackChunkSize) {
    out.push({
      start: off,
      end: Math.min(text.length, off + fallbackChunkSize),
      name: null,
      kind: fallbackKind,
      meta: {}
    });
  }
  return applyChunkingLimits(out, text, context);
}
