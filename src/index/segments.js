import { parse, postprocess, preprocess } from 'micromark';
import { parse as parseAstro } from '@astrojs/compiler/sync';
import { parse as parseSvelte } from 'svelte/compiler';
import { parse as parseVue } from '@vue/compiler-sfc';
import { parseBabelAst } from '../lang/babel-parser.js';
import { buildLineIndex, offsetToLine } from '../shared/lines.js';
import { sha1 } from '../shared/hash.js';
import { smartChunk } from './chunking.js';

const CONFIG_EXTS = new Set([
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml'
]);

const LANGUAGE_ID_EXT = new Map([
  ['javascript', '.js'],
  ['typescript', '.ts'],
  ['tsx', '.tsx'],
  ['jsx', '.jsx'],
  ['html', '.html'],
  ['css', '.css'],
  ['scss', '.css'],
  ['sass', '.css'],
  ['less', '.css'],
  ['markdown', '.md'],
  ['yaml', '.yaml'],
  ['json', '.json'],
  ['toml', '.toml'],
  ['ini', '.ini'],
  ['xml', '.xml'],
  ['python', '.py'],
  ['ruby', '.rb'],
  ['php', '.php'],
  ['go', '.go'],
  ['rust', '.rs'],
  ['java', '.java'],
  ['c', '.c'],
  ['cpp', '.cpp'],
  ['csharp', '.cs'],
  ['kotlin', '.kt'],
  ['sql', '.sql'],
  ['shell', '.sh'],
  ['cmake', '.cmake'],
  ['starlark', '.bzl'],
  ['nix', '.nix'],
  ['dart', '.dart'],
  ['scala', '.scala'],
  ['groovy', '.groovy'],
  ['r', '.r'],
  ['julia', '.jl'],
  ['handlebars', '.hbs'],
  ['mustache', '.mustache'],
  ['jinja', '.jinja'],
  ['razor', '.razor']
]);

const CONFIG_LANGS = new Set(['json', 'yaml', 'toml']);

const MARKDOWN_FENCE_LANG_ALIASES = new Map([
  ['js', 'javascript'],
  ['javascript', 'javascript'],
  ['jsx', 'javascript'],
  ['ts', 'typescript'],
  ['typescript', 'typescript'],
  ['tsx', 'typescript'],
  ['html', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['sass', 'sass'],
  ['less', 'less'],
  ['json', 'json'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['xml', 'xml'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['shell', 'shell'],
  ['py', 'python'],
  ['python', 'python'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['go', 'go'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['csharp', 'csharp'],
  ['cs', 'csharp'],
  ['kotlin', 'kotlin'],
  ['kt', 'kotlin'],
  ['php', 'php'],
  ['sql', 'sql'],
  ['cmake', 'cmake'],
  ['bazel', 'starlark'],
  ['starlark', 'starlark'],
  ['bzl', 'starlark'],
  ['nix', 'nix'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['groovy', 'groovy'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['handlebars', 'handlebars'],
  ['hbs', 'handlebars'],
  ['mustache', 'mustache'],
  ['jinja', 'jinja'],
  ['jinja2', 'jinja'],
  ['django', 'jinja'],
  ['razor', 'razor'],
  ['cshtml', 'razor']
]);

const resolveSegmentType = (mode, ext) => {
  if (mode === 'prose') return 'prose';
  if (CONFIG_EXTS.has(ext)) return 'config';
  return 'code';
};

const resolveSegmentTokenMode = (segment) => {
  const hint = segment.embeddingContext || segment.meta?.embeddingContext || null;
  if (hint === 'prose') return 'prose';
  if (hint === 'code' || hint === 'config') return 'code';
  if (segment.type === 'prose' || segment.type === 'comment') return 'prose';
  return 'code';
};

const shouldIndexSegment = (segment, tokenMode, fileMode) => {
  if (segment.type === 'embedded') return true;
  return tokenMode === fileMode;
};

const resolveSegmentExt = (baseExt, segment) => {
  if (segment.ext) return segment.ext;
  if (segment.languageId && LANGUAGE_ID_EXT.has(segment.languageId)) {
    return LANGUAGE_ID_EXT.get(segment.languageId);
  }
  return baseExt;
};

const buildSegmentId = (relPath, segment) => {
  const key = [
    relPath || '',
    segment.type,
    segment.languageId || '',
    segment.start,
    segment.end,
    segment.parentSegmentId || ''
  ].join('|');
  return `seg_${sha1(key)}`;
};

const normalizeFenceLanguage = (raw) => {
  if (!raw) return null;
  const normalized = String(raw).trim().split(/\s+/)[0]?.toLowerCase();
  if (!normalized) return null;
  return MARKDOWN_FENCE_LANG_ALIASES.get(normalized) || normalized;
};

const normalizeLimit = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
};

export function normalizeSegmentsConfig(input = {}) {
  const cfg = input && typeof input === 'object' ? input : {};
  const inlineCodeSpans = cfg.inlineCodeSpans === true;
  return {
    inlineCodeSpans,
    inlineCodeMinChars: normalizeLimit(cfg.inlineCodeMinChars, 8),
    inlineCodeMaxSpans: normalizeLimit(cfg.inlineCodeMaxSpans, 200),
    inlineCodeMaxBytes: normalizeLimit(cfg.inlineCodeMaxBytes, 64 * 1024),
    frontmatterProse: cfg.frontmatterProse === true,
    onlyExtras: cfg.onlyExtras === true
  };
}

const normalizeLanguageHint = (raw, fallback) => {
  if (!raw) return fallback;
  const normalized = String(raw).trim().split(/\s+/)[0]?.toLowerCase();
  if (!normalized) return fallback;
  return MARKDOWN_FENCE_LANG_ALIASES.get(normalized) || normalized || fallback;
};

const hasMeaningfulText = (text) => /\S/.test(text || '');

export const detectFrontmatter = (text) => {
  if (!text.startsWith('---') && !text.startsWith('+++') && !text.startsWith(';;;')) return null;
  const lines = text.split('\n');
  if (!lines.length) return null;
  const fence = lines[0].trim();
  if (!['---', '+++', ';;;'].includes(fence)) return null;
  let endLine = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === fence || (fence === '---' && trimmed === '...')) {
      endLine = i;
      break;
    }
  }
  if (endLine < 0) return null;
  let endOffset = 0;
  for (let i = 0; i <= endLine; i += 1) {
    endOffset += lines[i].length;
    if (i < endLine) endOffset += 1;
  }
  if (text[endOffset] === '\n') endOffset += 1;
  const languageId = fence === '+++'
    ? 'toml'
    : (fence === ';;;' ? 'json' : 'yaml');
  return { start: 0, end: endOffset, languageId };
};

const extractInlineCodeSpans = (text, config) => {
  if (!config?.inlineCodeSpans) return [];
  const minChars = normalizeLimit(config.inlineCodeMinChars, 8);
  const maxSpans = normalizeLimit(config.inlineCodeMaxSpans, 200);
  const maxBytes = normalizeLimit(config.inlineCodeMaxBytes, 64 * 1024);
  const events = postprocess(parse().document().write(preprocess()(text, 'utf8', true)));
  const spans = [];
  let totalBytes = 0;
  for (const [action, token] of events) {
    if (action !== 'enter' || token.type !== 'codeTextData') continue;
    const start = token.start.offset;
    const end = token.end.offset;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const slice = text.slice(start, end);
    if (!hasMeaningfulText(slice)) continue;
    const nonWhitespace = slice.replace(/\s/g, '').length;
    if (nonWhitespace < minChars) continue;
    const bytes = Buffer.byteLength(slice, 'utf8');
    if (spans.length >= maxSpans || totalBytes + bytes > maxBytes) break;
    totalBytes += bytes;
    spans.push({ start, end });
  }
  return spans;
};

const extractFencedBlocks = (text) => {
  const events = postprocess(parse().document().write(preprocess()(text, 'utf8', true)));
  const blocks = [];
  let current = null;
  for (const [action, token] of events) {
    if (action === 'enter' && token.type === 'codeFenced') {
      current = { info: null, valueStart: null, valueEnd: null };
      continue;
    }
    if (!current) continue;
    if (action === 'enter' && token.type === 'codeFencedFenceInfo') {
      current.info = text.slice(token.start.offset, token.end.offset);
    }
    if (token.type === 'codeFlowValue') {
      if (action === 'enter') current.valueStart = token.start.offset;
      if (action === 'exit') current.valueEnd = token.end.offset;
    }
    if (action === 'exit' && token.type === 'codeFenced') {
      if (Number.isFinite(current.valueStart) && Number.isFinite(current.valueEnd)) {
        blocks.push({
          start: current.valueStart,
          end: current.valueEnd,
          info: current.info || null
        });
      }
      current = null;
    }
  }
  return blocks;
};

const segmentMarkdown = ({ text, ext, relPath, segmentsConfig }) => {
  const config = normalizeSegmentsConfig(segmentsConfig);
  const segments = [];
  const frontmatter = detectFrontmatter(text);
  if (frontmatter) {
    segments.push({
      type: 'config',
      languageId: frontmatter.languageId,
      start: frontmatter.start,
      end: frontmatter.end,
      parentSegmentId: null,
      embeddingContext: 'config',
      meta: { frontmatter: true }
    });
    if (config.frontmatterProse) {
      segments.push({
        type: 'prose',
        languageId: 'markdown',
        start: frontmatter.start,
        end: frontmatter.end,
        parentSegmentId: null,
        embeddingContext: 'prose',
        meta: { frontmatter: true }
      });
    }
  }
  const fencedBlocks = extractFencedBlocks(text);
  for (const block of fencedBlocks) {
    if (frontmatter && block.start < frontmatter.end) continue;
    const languageId = normalizeFenceLanguage(block.info);
    const embeddingContext = CONFIG_LANGS.has(languageId) ? 'config' : 'code';
    segments.push({
      type: 'embedded',
      languageId,
      start: block.start,
      end: block.end,
      parentSegmentId: null,
      embeddingContext,
      meta: { fenceInfo: block.info || null }
    });
  }
  if (config.inlineCodeSpans) {
    const spans = extractInlineCodeSpans(text, config);
    for (const span of spans) {
      if (frontmatter && span.start < frontmatter.end) continue;
      segments.push({
        type: 'embedded',
        languageId: 'markdown',
        start: span.start,
        end: span.end,
        parentSegmentId: null,
        embeddingContext: 'code',
        meta: { inlineCode: true }
      });
    }
  }
  const special = segments.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  if (special.length) {
    for (const seg of special) {
      if (seg.start > cursor) {
        const slice = text.slice(cursor, seg.start);
        if (hasMeaningfulText(slice)) {
          segments.push({
            type: 'prose',
            languageId: 'markdown',
            start: cursor,
            end: seg.start,
            parentSegmentId: null,
            embeddingContext: 'prose',
            meta: {}
          });
        }
      }
      cursor = Math.max(cursor, seg.end);
    }
  }
  if (cursor < text.length) {
    const slice = text.slice(cursor);
    if (hasMeaningfulText(slice)) {
      segments.push({
        type: 'prose',
        languageId: 'markdown',
        start: cursor,
        end: text.length,
        parentSegmentId: null,
        embeddingContext: 'prose',
        meta: {}
      });
    }
  }
  if (!segments.length) {
    segments.push({
      type: resolveSegmentType('prose', ext),
      languageId: 'markdown',
      start: 0,
      end: text.length,
      parentSegmentId: null,
      embeddingContext: 'prose',
      meta: {}
    });
  }
  return finalizeSegments(segments, relPath);
};

const segmentVue = ({ text, relPath }) => {
  let descriptor = null;
  try {
    ({ descriptor } = parseVue(text, { sourceMap: false }));
  } catch {
    return null;
  }
  if (!descriptor) return null;
  const segments = [];
  const addBlock = (block, blockType, fallbackLang) => {
    if (!block?.loc) return;
    const start = block.loc.start?.offset;
    const end = block.loc.end?.offset;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const languageId = normalizeLanguageHint(block.lang, fallbackLang);
    segments.push({
      type: 'embedded',
      languageId,
      start,
      end,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: blockType, lang: block.lang || null }
    });
  };
  addBlock(descriptor.template, 'template', 'html');
  addBlock(descriptor.script, 'script', 'javascript');
  addBlock(descriptor.scriptSetup, 'scriptSetup', 'javascript');
  for (const style of descriptor.styles || []) {
    addBlock(style, 'style', 'css');
  }
  return segments.length ? finalizeSegments(segments, relPath) : null;
};

const segmentSvelte = ({ text, relPath }) => {
  let ast = null;
  try {
    ast = parseSvelte(text);
  } catch {
    return null;
  }
  if (!ast) return null;
  const segments = [];
  const addContentBlock = (node, blockType, fallbackLang) => {
    const content = node?.content || null;
    const start = content?.start ?? node?.start;
    const end = content?.end ?? node?.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const languageId = normalizeLanguageHint(node?.lang, fallbackLang);
    segments.push({
      type: 'embedded',
      languageId,
      start,
      end,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: blockType }
    });
  };
  addContentBlock(ast.instance, 'script', 'javascript');
  addContentBlock(ast.module, 'scriptModule', 'javascript');
  addContentBlock(ast.css, 'style', 'css');
  if (Number.isFinite(ast.html?.start) && Number.isFinite(ast.html?.end) && ast.html.end > ast.html.start) {
    segments.push({
      type: 'embedded',
      languageId: 'html',
      start: ast.html.start,
      end: ast.html.end,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: 'template' }
    });
  }
  return segments.length ? finalizeSegments(segments, relPath) : null;
};

const segmentAstro = ({ text, relPath }) => {
  let ast = null;
  try {
    const result = parseAstro(text);
    ast = result?.ast || null;
  } catch {
    return null;
  }
  if (!ast || !Array.isArray(ast.children)) return null;
  const segments = [];
  const addFrontmatter = (node) => {
    const value = typeof node?.value === 'string' ? node.value : '';
    const position = node?.position;
    if (!position?.start || !position?.end) return;
    let start = text.indexOf(value, position.start.offset);
    if (start < 0) start = position.start.offset;
    const end = start + value.length;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    segments.push({
      type: 'embedded',
      languageId: 'javascript',
      start,
      end,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: 'frontmatter' }
    });
  };
  const addElementBlock = (node, blockType, fallbackLang) => {
    if (!Array.isArray(node?.children) || !node.children.length) return;
    let start = null;
    let end = null;
    for (const child of node.children) {
      const pos = child?.position;
      const childStart = pos?.start?.offset;
      const childEnd = pos?.end?.offset;
      if (!Number.isFinite(childStart) || !Number.isFinite(childEnd)) continue;
      if (start == null || childStart < start) start = childStart;
      if (end == null || childEnd > end) end = childEnd;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const languageId = normalizeLanguageHint(node?.attributes?.find?.((attr) => attr?.name === 'lang')?.value, fallbackLang);
    segments.push({
      type: 'embedded',
      languageId,
      start,
      end,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: blockType }
    });
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'frontmatter') addFrontmatter(node);
    if (node.type === 'element') {
      const name = String(node.name || '').toLowerCase();
      if (name === 'script') addElementBlock(node, 'script', 'javascript');
      if (name === 'style') addElementBlock(node, 'style', 'css');
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  for (const child of ast.children) walk(child);
  if (!segments.length) return null;
  const special = segments.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  for (const seg of special) {
    if (seg.start > cursor) {
      const slice = text.slice(cursor, seg.start);
      if (hasMeaningfulText(slice)) {
        segments.push({
          type: 'embedded',
          languageId: 'html',
          start: cursor,
          end: seg.start,
          parentSegmentId: null,
          embeddingContext: 'code',
          meta: { block: 'template' }
        });
      }
    }
    cursor = Math.max(cursor, seg.end);
  }
  if (cursor < text.length && hasMeaningfulText(text.slice(cursor))) {
    segments.push({
      type: 'embedded',
      languageId: 'html',
      start: cursor,
      end: text.length,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: 'template' }
    });
  }
  return finalizeSegments(segments, relPath);
};

const collectJsxRanges = (node, ranges, seen = new Set()) => {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
    const start = Number.isFinite(node.start) ? node.start : (Array.isArray(node.range) ? node.range[0] : null);
    const end = Number.isFinite(node.end) ? node.end : (Array.isArray(node.range) ? node.range[1] : null);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      ranges.push({ start, end });
    }
  }
  for (const value of Object.values(node)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const entry of value) collectJsxRanges(entry, ranges, seen);
    } else if (typeof value === 'object' && value.type) {
      collectJsxRanges(value, ranges, seen);
    }
  }
};

const mergeRanges = (ranges) => {
  if (!ranges.length) return [];
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  let current = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.start <= current.end) {
      current = { start: current.start, end: Math.max(current.end, next.end) };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
};

const segmentJsx = ({ text, ext, relPath, languageId, context }) => {
  const baseLang = languageId || (ext === '.tsx' ? 'typescript' : 'javascript');
  let ast = context?.jsAst || null;
  if (!ast) {
    const mode = ext === '.tsx' ? 'typescript' : 'javascript';
    ast = parseBabelAst(text, { ext, mode });
  }
  if (!ast) return null;
  const ranges = [];
  collectJsxRanges(ast, ranges);
  const merged = mergeRanges(ranges);
  if (!merged.length) return null;
  const segments = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      const slice = text.slice(cursor, range.start);
      if (hasMeaningfulText(slice)) {
        segments.push({
          type: 'code',
          languageId: baseLang,
          start: cursor,
          end: range.start,
          parentSegmentId: null,
          embeddingContext: 'code',
          meta: {}
        });
      }
    }
    segments.push({
      type: 'embedded',
      languageId: 'html',
      start: range.start,
      end: range.end,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: 'jsx' }
    });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) {
    const slice = text.slice(cursor);
    if (hasMeaningfulText(slice)) {
      segments.push({
        type: 'code',
        languageId: baseLang,
        start: cursor,
        end: text.length,
        parentSegmentId: null,
        embeddingContext: 'code',
        meta: {}
      });
    }
  }
  return finalizeSegments(segments, relPath);
};

const finalizeSegments = (segments, relPath) => {
  const output = [];
  for (const segment of segments || []) {
    if (!segment) continue;
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const normalized = {
      ...segment,
      start,
      end
    };
    normalized.segmentId = normalized.segmentId || buildSegmentId(relPath, normalized);
    output.push(normalized);
  }
  output.sort((a, b) => a.start - b.start || a.end - b.end);
  return output;
};

export function discoverSegments({
  text,
  ext,
  relPath,
  mode,
  languageId = null,
  context = null,
  segmentsConfig = null,
  extraSegments = []
}) {
  const config = normalizeSegmentsConfig(segmentsConfig);
  if (config.onlyExtras) {
    return finalizeSegments(extraSegments || [], relPath);
  }
  if (ext === '.md' || ext === '.mdx') {
    const segments = segmentMarkdown({ text, ext, relPath, segmentsConfig: config });
    return extraSegments && extraSegments.length
      ? finalizeSegments([...segments, ...extraSegments], relPath)
      : segments;
  }
  if (ext === '.jsx' || ext === '.tsx') {
    const segments = segmentJsx({ text, ext, relPath, languageId, context });
    if (segments) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...segments, ...extraSegments], relPath)
        : segments;
    }
  }
  if (ext === '.vue') {
    const segments = segmentVue({ text, relPath });
    if (segments) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...segments, ...extraSegments], relPath)
        : segments;
    }
  }
  if (ext === '.svelte') {
    const segments = segmentSvelte({ text, relPath });
    if (segments) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...segments, ...extraSegments], relPath)
        : segments;
    }
  }
  if (ext === '.astro') {
    const segments = segmentAstro({ text, relPath });
    if (segments) {
      return extraSegments && extraSegments.length
        ? finalizeSegments([...segments, ...extraSegments], relPath)
        : segments;
    }
  }
  const baseSegment = {
    type: resolveSegmentType(mode, ext),
    languageId,
    start: 0,
    end: text.length,
    parentSegmentId: null,
    meta: {}
  };
  return extraSegments && extraSegments.length
    ? finalizeSegments([baseSegment, ...extraSegments], relPath)
    : finalizeSegments([baseSegment], relPath);
}

export function chunkSegments({
  text,
  ext,
  relPath,
  mode,
  context = {},
  segments = [],
  lineIndex = null
}) {
  const effectiveMode = mode === 'extracted-prose' ? 'prose' : mode;
  const resolvedLineIndex = lineIndex || buildLineIndex(text);
  const chunks = [];
  for (const segment of segments) {
    const segmentText = text.slice(segment.start, segment.end);
    const tokenMode = resolveSegmentTokenMode(segment);
    if (!shouldIndexSegment(segment, tokenMode, effectiveMode)) continue;
    const segmentExt = resolveSegmentExt(ext, segment);
    const segmentContext = {
      ...context,
      languageId: segment.languageId || context.languageId || null,
      segment
    };
    const segmentChunks = smartChunk({
      text: segmentText,
      ext: segmentExt,
      relPath,
      mode: tokenMode,
      context: segmentContext,
      languageId: segment.languageId || null
    });
    if (!Array.isArray(segmentChunks) || !segmentChunks.length) continue;
    const segmentStartLine = offsetToLine(resolvedLineIndex, segment.start);
    for (const chunk of segmentChunks) {
      if (!chunk) continue;
      const adjusted = { ...chunk };
      adjusted.start = chunk.start + segment.start;
      adjusted.end = chunk.end + segment.start;
      if (adjusted.meta && typeof adjusted.meta === 'object') {
        if (Number.isFinite(adjusted.meta.startLine)) {
          adjusted.meta.startLine = segmentStartLine + adjusted.meta.startLine - 1;
        }
        if (Number.isFinite(adjusted.meta.endLine)) {
          adjusted.meta.endLine = segmentStartLine + adjusted.meta.endLine - 1;
        }
      }
      adjusted.segment = {
        segmentId: segment.segmentId,
        type: segment.type,
        languageId: segment.languageId || null,
        start: segment.start,
        end: segment.end,
        parentSegmentId: segment.parentSegmentId || null,
        embeddingContext: segment.embeddingContext || segment.meta?.embeddingContext || null
      };
      chunks.push(adjusted);
    }
  }
  if (chunks.length > 1) {
    chunks.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  }
  return chunks;
}
