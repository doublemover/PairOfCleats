import { parseDockerfileFromClause, parseDockerfileInstruction } from '../../../shared/dockerfile.js';
import { parseDockerfileStructure } from '../../../shared/dockerfile-ast.js';
import { parseHandlebarsStructure } from '../../../shared/handlebars-ast.js';
import { parseMustacheStructure } from '../../../shared/mustache-structure.js';
import { parseJinjaTemplateStructure } from '../../../shared/jinja-template-structure.js';
import { buildChunksFromLineHeadings } from '../helpers.js';
import {
  MAX_REGEX_LINE,
  applyFormatMeta,
  chunkByLineRegex,
  collectHeadingRows,
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
/**
 * Skip structurally meaningless Nix lines for heading extraction.
 * @param {string} line
 * @returns {boolean}
 */
const NIX_SKIP_LINE = (line) => {
  const trimmed = line.trim();
  return !trimmed || trimmed.startsWith('#') || trimmed === 'in' || trimmed === 'let';
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

/**
 * Full-file fallback chunk used when no structural headings are detected.
 * @param {string} text
 * @param {string} name
 * @param {string} kind
 * @param {string|null} format
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
const buildSingleChunk = (text, name, kind, format) => [{
  start: 0,
  end: text.length,
  name,
  kind,
  meta: format ? { format } : {}
}];

/**
 * Convert heading rows into bounded chunks and attach format metadata.
 * Falls back to a single full-file chunk when heading extraction yields none.
 *
 * @param {object} input
 * @param {string} input.text
 * @param {Array<{line:number,title:string}>} input.headings
 * @param {number[]} input.lineIndex
 * @param {string} input.format
 * @param {string} input.kind
 * @param {string} input.fallbackName
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
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

/**
 * Bounded Dockerfile AST headings preserve logical instructions and stage/image
 * identity. Missing/unsupported parsing retains an explicitly heuristic fallback.
 *
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const createDockerfileChunker = ({ parseStructure = parseDockerfileStructure } = {}) => (text, context = null) => {
  const { lines, lineIndex } = splitLinesWithIndex(text, context);
  const headings = [];
  const structure = parseStructure(text);
  if (structure.parser === 'dockerfile-ast') {
    const chunks = buildFormattedChunksFromHeadings({ text,
      headings: structure.instructions.map((instruction) => ({ line: instruction.line, title: instruction.title })),
      lineIndex, format: 'dockerfile', kind: 'ConfigSection', fallbackName: 'Dockerfile' });
    return chunks.map((chunk, index) => ({ ...chunk, meta: { ...chunk.meta,
      parser: structure.parser, parserCoverage: structure.coverage,
      ...(structure.instructions[index] ? { astRange: {
        start: structure.instructions[index].start, end: structure.instructions[index].end
      } } : {}) } }));
  }
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
  }).map((chunk) => ({ ...chunk, meta: { ...chunk.meta, parser: structure.parser,
    parserCoverage: structure.coverage, parserFallbackReason: structure.reason } }));
};

export const chunkDockerfile = createDockerfileChunker();

/**
 * Heuristic Makefile chunker by target declarations.
 *
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
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

/**
 * Heuristic CMake chunker by command invocations.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const chunkCmake = (text, context = null) => chunkByLineRegex(
  text,
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
  CMAKE_OPTIONS,
  context
);

/**
 * Heuristic Starlark chunker by defs/classes and high-signal top-level calls.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
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

/**
 * Heuristic Nix chunker by assignment headings.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const chunkNix = (text, context = null) => chunkByLineRegex(
  text,
  /^\s*([A-Za-z0-9_.-]+)\s*=/,
  NIX_OPTIONS,
  context
);

/**
 * Heuristic Dart chunker by type and function declarations.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const chunkDart = (text, context = null) => {
  const { headings, lineIndex } = collectHeadingRows(text, context, {
    skipLine: (line, trimmed) => trimmed.startsWith('//'),
    precheck: (line) => line.includes('class')
      || line.includes('mixin')
      || line.includes('enum')
      || line.includes('extension')
      || line.includes('typedef')
      || line.includes('('),
    collect: (line, trimmed, i) => {
      void trimmed;
      const typeMatch = line.match(DART_TYPE_RX);
      if (typeMatch) {
        return { line: i, title: typeMatch[2] };
      }
      const funcMatch = line.match(DART_FUNC_RX);
      if (funcMatch && !DART_SKIP_NAMES.has(funcMatch[1])) {
        return { line: i, title: funcMatch[1] };
      }
      return null;
    }
  });
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'dart',
    kind: 'Section',
    fallbackName: 'dart'
  });
};

/**
 * Heuristic Scala chunker by type/object/trait/enum and `def` declarations.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const chunkScala = (text, context = null) => {
  const { headings, lineIndex } = collectHeadingRows(text, context, {
    skipLine: (line, trimmed) => trimmed.startsWith('//'),
    precheck: (line) => line.includes('class')
      || line.includes('object')
      || line.includes('trait')
      || line.includes('enum')
      || line.includes('def'),
    collect: (line, trimmed, i) => {
      void trimmed;
      const typeMatch = line.match(SCALA_TYPE_RX);
      if (typeMatch) {
        return { line: i, title: typeMatch[1] };
      }
      const defMatch = line.match(SCALA_DEF_RX);
      return defMatch ? { line: i, title: defMatch[1] } : null;
    }
  });
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'scala',
    kind: 'Section',
    fallbackName: 'scala'
  });
};

/**
 * Heuristic Groovy chunker by type declarations and `def` members.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const chunkGroovy = (text, context = null) => {
  const { headings, lineIndex } = collectHeadingRows(text, context, {
    skipLine: (line, trimmed) => trimmed.startsWith('//'),
    precheck: (line) => line.includes('class')
      || line.includes('interface')
      || line.includes('trait')
      || line.includes('enum')
      || line.includes('def'),
    collect: (line, trimmed, i) => {
      void trimmed;
      const typeMatch = line.match(GROOVY_TYPE_RX);
      if (typeMatch) {
        return { line: i, title: typeMatch[2] };
      }
      const defMatch = line.match(GROOVY_DEF_RX);
      return defMatch ? { line: i, title: defMatch[1] } : null;
    }
  });
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'groovy',
    kind: 'Section',
    fallbackName: 'groovy'
  });
};

/**
 * Heuristic R chunker for function assignments.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const chunkR = (text, context = null) => chunkByLineRegex(
  text,
  /^\s*([A-Za-z.][A-Za-z0-9_.]*)\s*(?:<-|=)\s*function\b/,
  R_OPTIONS,
  context
);

/**
 * Heuristic Julia chunker for modules/functions/macros.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const chunkJulia = (text, context = null) => {
  const { headings, lineIndex } = collectHeadingRows(text, context, {
    skipLine: (line, trimmed) => trimmed.startsWith('#'),
    precheck: (line) => line.includes('module') || line.includes('function') || line.includes('macro'),
    collect: (line, trimmed, i) => {
      void trimmed;
      const match = line.match(JULIA_RX);
      return match ? { line: i, title: match[2] } : null;
    }
  });
  return buildFormattedChunksFromHeadings({
    text,
    headings,
    lineIndex,
    format: 'julia',
    kind: 'Section',
    fallbackName: 'julia'
  });
};

/**
 * Handlebars syntax chunks by outermost real blocks, with honest heuristic fallback.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const createHandlebarsChunker = ({ parseStructure = parseHandlebarsStructure } = {}) => (text, context = null) => {
  const structure = parseStructure(text);
  if (structure.parser === 'handlebars-parser') {
    const blocks = structure.blocks.length ? structure.blocks : [{ start: 0, end: text.length, name: 'handlebars' }];
    const dynamicPartials = structure.partials.filter((partial) => partial.kind === 'dynamic');
    let cursor = 0;
    return blocks.map((block, index) => {
      const end = blocks[index + 1]?.start ?? text.length;
      let unresolvedDynamicPartials = 0;
      while (cursor < dynamicPartials.length && dynamicPartials[cursor].start < end) {
        if (dynamicPartials[cursor].start >= block.start) unresolvedDynamicPartials += 1;
        cursor += 1;
      }
      return { start: block.start, end, name: block.name, kind: 'Section', meta: { format: 'handlebars', title: block.name,
        definitionType: block.definitionType || null, parser: structure.parser, parserCoverage: structure.coverage,
        ...(block.definitionType ? { astRange: { start: block.start, end: block.end } } : {}),
        unresolvedDynamicPartials } };
    });
  }
  return chunkByLineRegex(text, /{{[#^]\s*([A-Za-z0-9_.-]+)\b/, HANDLEBARS_OPTIONS, context)
    .map((chunk) => ({ ...chunk, meta: { ...chunk.meta, parser: structure.parser,
      parserCoverage: structure.coverage, parserFallbackReason: structure.reason } }));
};

export const chunkHandlebars = createHandlebarsChunker();

/**
 * Mustache sections from verified vendor opening-tag ranges. Chunk extents
 * partition the document; closeStart is a vendor offset, not a full AST range.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const createMustacheChunker = ({ parseStructure = parseMustacheStructure } = {}) => (text, context = null) => {
  const source = String(text || '');
  const configuredMs = context?.treeSitter?.byLanguage?.mustache?.maxParseMs ?? context?.treeSitter?.maxParseMs;
  const structure = parseStructure(source, { maxMs: configuredMs });
  const meta = { format: 'mustache', parser: structure.parser, parserCoverage: structure.coverage,
    parserFallbackReason: structure.reason, parseMetrics: structure.metrics };
  if (!structure.blocks.length) return [{ start: 0, end: source.length, name: 'mustache', kind: 'Section', meta }];
  return structure.blocks.map((block, index) => ({ start: block.start,
    end: structure.blocks[index + 1]?.start ?? source.length, name: block.name, kind: 'Section',
    meta: { ...meta, title: block.name, definitionType: block.type === '^' ? 'inverted-section' : 'section',
      rangeSource: structure.rangeSource, tokenRange: { start: block.start, end: block.end },
      sectionCloseStart: block.closeStart } }));
};

export const chunkMustache = createMustacheChunker();

/**
 * Heuristic Jinja chunker by directive blocks.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
export const createJinjaChunker = ({ parseStructure = parseJinjaTemplateStructure } = {}) => (text, context = null) => {
  const source = String(text || '');
  const structure = parseStructure(source, { ext: context?.ext, relPath: context?.relPath,
    maxMs: context?.treeSitter?.byLanguage?.jinja?.maxParseMs ?? context?.treeSitter?.maxParseMs });
  const meta = { format: 'jinja', templateDialect: structure.dialect, parser: structure.parser,
    parserCoverage: structure.coverage, parserFallbackReason: structure.reason, parseMetrics: structure.metrics };
  if (!structure.headings.length) return [{ start: 0, end: source.length, name: 'jinja', kind: 'Section', meta }];
  return structure.headings.map((heading, index) => ({ start: heading.start,
    end: structure.headings[index + 1]?.start ?? source.length, name: heading.name, kind: 'Section',
    meta: { ...meta, title: heading.name, definitionType: heading.keyword,
      rangeSource: structure.rangeSource, lexicalRange: { start: heading.start, end: heading.end } } }));
};

export const chunkJinja = createJinjaChunker();

/**
 * Heuristic Razor chunker for common `@` directives.
 * @param {string} text
 * @param {object|null} [context]
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:object}>}
 */
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
