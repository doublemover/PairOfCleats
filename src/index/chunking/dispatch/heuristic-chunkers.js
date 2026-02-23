import { parseDockerfileFromClause, parseDockerfileInstruction } from '../../../shared/dockerfile.js';
import { buildChunksFromLineHeadings } from '../helpers.js';
import {
  MAX_REGEX_LINE,
  applyFormatMeta,
  chunkByLineRegex,
  splitLinesWithIndex
} from './shared.js';

const MAKEFILE_TARGET_RX = /^([A-Za-z0-9_./-]+)\s*:/;
const STARLARK_DEF_RX = /^\s*(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
const STARLARK_CALL_RX = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const DART_TYPE_RX = /^\s*(class|mixin|enum|extension|typedef)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const DART_FUNC_RX = /^\s*(?:[A-Za-z_][A-Za-z0-9_<>]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const SCALA_TYPE_RX = /^\s*(?:case\s+class|class|object|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const SCALA_DEF_RX = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/;
const GROOVY_TYPE_RX = /^\s*(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const GROOVY_DEF_RX = /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/;
const JULIA_RX = /^\s*(module|function|macro)\s+([A-Za-z_][A-Za-z0-9_!.]*)/;
const RAZOR_RX = /^\s*@\s*(page|model|inherits|functions|code|section)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/i;

const DART_SKIP_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new']);
const NIX_SKIP_LINE = (line) => {
  const trimmed = line.trim();
  return !trimmed || trimmed.startsWith('#') || trimmed === 'in' || trimmed === 'let';
};
const JINJA_TITLE = (match) => {
  const raw = String(match[2] || '').trim();
  if (!raw) return match[1];
  const boundary = raw.search(/\s/);
  const name = boundary === -1 ? raw : raw.slice(0, boundary);
  return name ? `${match[1]} ${name}` : match[1];
};

const CMAKE_OPTIONS = {
  format: 'cmake',
  kind: 'ConfigSection',
  defaultName: 'cmake',
  skipLine: (line) => line.trim().startsWith('#'),
  precheck: (line) => line.includes('(')
};
const NIX_OPTIONS = {
  format: 'nix',
  kind: 'Section',
  defaultName: 'nix',
  skipLine: NIX_SKIP_LINE,
  precheck: (line) => line.includes('=')
};
const R_OPTIONS = {
  format: 'r',
  kind: 'Section',
  defaultName: 'r',
  precheck: (line) => line.includes('function')
};
const HANDLEBARS_OPTIONS = {
  format: 'handlebars',
  kind: 'Section',
  defaultName: 'handlebars',
  precheck: (line) => line.includes('{{')
};
const MUSTACHE_OPTIONS = {
  format: 'mustache',
  kind: 'Section',
  defaultName: 'mustache',
  precheck: (line) => line.includes('{{')
};
const JINJA_OPTIONS = {
  format: 'jinja',
  kind: 'Section',
  defaultName: 'jinja',
  precheck: (line) => line.includes('{%'),
  title: JINJA_TITLE
};

const buildSingleChunk = (text, name, kind, format) => [{
  start: 0,
  end: text.length,
  name,
  kind,
  meta: format ? { format } : {}
}];

const buildFormattedChunksFromHeadings = ({
  text,
  headings,
  lineIndex,
  format,
  kind,
  fallbackName
}) => {
  const chunks = buildChunksFromLineHeadings(text, headings, lineIndex);
  if (chunks && chunks.length) {
    return applyFormatMeta(chunks, format, kind);
  }
  return buildSingleChunk(text, fallbackName, kind, format);
};

export const chunkDockerfile = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
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
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'dockerfile',
    kind: 'ConfigSection',
    fallbackName: 'Dockerfile'
  });
};

export const chunkMakefile = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!line.includes(':')) continue;
    const match = line.match(MAKEFILE_TARGET_RX);
    if (match) headings.push({ line: i, title: match[1] });
  }
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'makefile',
    kind: 'ConfigSection',
    fallbackName: 'Makefile'
  });
};

export const chunkCmake = (text, context = null) => chunkByLineRegex(
  text,
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
  CMAKE_OPTIONS,
  context
);

export const chunkStarlark = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (!(line.includes('def') || line.includes('class') || line.includes('('))) continue;
    const defMatch = line.match(STARLARK_DEF_RX);
    if (defMatch) {
      headings.push({ line: i, title: `${defMatch[1]} ${defMatch[2]}` });
      continue;
    }
    const callMatch = line.match(STARLARK_CALL_RX);
    if (callMatch) headings.push({ line: i, title: callMatch[1] });
  }
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'starlark',
    kind: 'Section',
    fallbackName: 'starlark'
  });
};

export const chunkNix = (text, context = null) => chunkByLineRegex(
  text,
  /^\s*([A-Za-z0-9_.-]+)\s*=/,
  NIX_OPTIONS,
  context
);

export const chunkDart = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    if (!(line.includes('class')
      || line.includes('mixin')
      || line.includes('enum')
      || line.includes('extension')
      || line.includes('typedef')
      || line.includes('('))) {
      continue;
    }
    const typeMatch = line.match(DART_TYPE_RX);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[2] });
      continue;
    }
    const funcMatch = line.match(DART_FUNC_RX);
    if (funcMatch && !DART_SKIP_NAMES.has(funcMatch[1])) {
      headings.push({ line: i, title: funcMatch[1] });
    }
  }
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'dart',
    kind: 'Section',
    fallbackName: 'dart'
  });
};

export const chunkScala = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    if (!(line.includes('class')
      || line.includes('object')
      || line.includes('trait')
      || line.includes('enum')
      || line.includes('def'))) {
      continue;
    }
    const typeMatch = line.match(SCALA_TYPE_RX);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[1] });
      continue;
    }
    const defMatch = line.match(SCALA_DEF_RX);
    if (defMatch) headings.push({ line: i, title: defMatch[1] });
  }
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'scala',
    kind: 'Section',
    fallbackName: 'scala'
  });
};

export const chunkGroovy = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    if (!(line.includes('class')
      || line.includes('interface')
      || line.includes('trait')
      || line.includes('enum')
      || line.includes('def'))) {
      continue;
    }
    const typeMatch = line.match(GROOVY_TYPE_RX);
    if (typeMatch) {
      headings.push({ line: i, title: typeMatch[2] });
      continue;
    }
    const defMatch = line.match(GROOVY_DEF_RX);
    if (defMatch) headings.push({ line: i, title: defMatch[1] });
  }
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'groovy',
    kind: 'Section',
    fallbackName: 'groovy'
  });
};

export const chunkR = (text, context = null) => chunkByLineRegex(
  text,
  /^\s*([A-Za-z.][A-Za-z0-9_.]*)\s*(?:<-|=)\s*function\b/,
  R_OPTIONS,
  context
);

export const chunkJulia = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (!(line.includes('module') || line.includes('function') || line.includes('macro'))) continue;
    const match = line.match(JULIA_RX);
    if (match) headings.push({ line: i, title: match[2] });
  }
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'julia',
    kind: 'Section',
    fallbackName: 'julia'
  });
};

export const chunkHandlebars = (text, context = null) => chunkByLineRegex(
  text,
  /{{[#^]\s*([A-Za-z0-9_.-]+)\b/,
  HANDLEBARS_OPTIONS,
  context
);

export const chunkMustache = (text, context = null) => chunkByLineRegex(
  text,
  /{{[#^]\s*([A-Za-z0-9_.-]+)\b/,
  MUSTACHE_OPTIONS,
  context
);

export const chunkJinja = (text, context = null) => chunkByLineRegex(
  text,
  /{%\s*(block|macro|for|if|set|include|extends)\s+([^%\n]+)%}/,
  JINJA_OPTIONS,
  context
);

export const chunkRazor = (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_REGEX_LINE) continue;
    if (!line.includes('@')) continue;
    const match = line.match(RAZOR_RX);
    if (!match) continue;
    const name = match[2] ? `${match[1]} ${match[2]}` : match[1];
    headings.push({ line: i, title: name });
  }
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'razor',
    kind: 'Section',
    fallbackName: 'razor'
  });
};
