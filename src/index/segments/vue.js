import { createRequire } from 'node:module';
import { normalizeLanguageHint } from './config.js';
import { finalizeSegments } from './finalize.js';
import { createAstroOffsetResolver } from './astro-offsets.js';

const require = createRequire(import.meta.url);
let parseAstro = null, parseSvelte = null, parseVue = null;
const loadParser = (name) => {
  const parser = require(name).parse;
  if (typeof parser !== 'function') throw new Error(`Required framework parser has no parse export: ${name}`);
  return parser;
};

export const segmentVue = ({ text, relPath }) => {
  parseVue ||= loadParser('@vue/compiler-sfc');
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

export const segmentSvelte = ({ text, relPath }) => {
  parseSvelte ||= loadParser('svelte/compiler');
  let ast = null;
  try {
    ast = parseSvelte(text);
  } catch {
    return null;
  }
  if (!ast) return null;
  const segments = [];
  const extractSvelteAttributeValue = (node, attrName) => {
    if (!node || !Array.isArray(node.attributes)) return '';
    const target = String(attrName || '').toLowerCase();
    const attr = node.attributes.find((entry) => String(entry?.name || '').toLowerCase() === target);
    if (!attr) return '';
    if (typeof attr.value === 'string') return attr.value.trim();
    if (Array.isArray(attr.value)) {
      return attr.value
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry && typeof entry === 'object') {
            if (typeof entry.data === 'string') return entry.data;
            if (typeof entry.raw === 'string') return entry.raw;
          }
          return '';
        })
        .join('')
        .trim();
    }
    if (attr.value && typeof attr.value === 'object') {
      if (typeof attr.value.data === 'string') return attr.value.data.trim();
      if (typeof attr.value.raw === 'string') return attr.value.raw.trim();
    }
    return '';
  };
  const addContentBlock = (node, blockType, fallbackLang) => {
    const content = node?.content || null;
    const start = content?.start ?? node?.start;
    const end = content?.end ?? node?.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    let langHint = node?.lang || extractSvelteAttributeValue(node, 'lang');
    if (!langHint
      && Number.isFinite(node?.start)
      && Number.isFinite(content?.start)
      && content.start > node.start) {
      const openTag = text.slice(node.start, Math.min(content.start, node.start + 256));
      const match = openTag.match(/\blang\s*=\s*["']([^"']+)["']/i);
      if (match?.[1]) {
        langHint = match[1].trim();
      }
    }
    const languageId = normalizeLanguageHint(langHint, fallbackLang);
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

export const segmentAstro = ({ text, relPath }) => {
  parseAstro ||= loadParser('@astrojs/compiler/sync');
  let ast = null;
  try {
    const result = parseAstro(text);
    ast = result?.ast || null;
  } catch {
    return null;
  }
  if (!ast || !Array.isArray(ast.children)) return null;
  const resolveOffset = createAstroOffsetResolver(text);
  const segments = [];
  let templateStart = null;
  let templateEnd = null;
  const extractAstroAttributeValue = (attr) => {
    if (!attr || typeof attr !== 'object') return '';
    const raw = attr.value;
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
      const joined = raw
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (entry && typeof entry === 'object') {
            if (typeof entry.data === 'string') return entry.data;
            if (typeof entry.value === 'string') return entry.value;
          }
          return '';
        })
        .join('')
        .trim();
      return joined;
    }
    if (raw && typeof raw === 'object') {
      if (typeof raw.data === 'string') return raw.data.trim();
      if (typeof raw.value === 'string') return raw.value.trim();
    }
    return '';
  };
  const updateTemplateRange = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'frontmatter' || node.type === 'root') return false;
    const pos = node.position;
    const start = resolveOffset(pos?.start?.offset);
    const end = resolveOffset(pos?.end?.offset);
    if (start === null || end === null || end <= start) return false;
    if (templateStart == null || start < templateStart) templateStart = start;
    if (templateEnd == null || end > templateEnd) templateEnd = end;
    return true;
  };
  const addFrontmatter = (node) => {
    const value = typeof node?.value === 'string' ? node.value : '';
    const position = node?.position;
    if (!position?.start || !position?.end) return;
    const containerStart = resolveOffset(position.start.offset);
    if (containerStart === null) return;
    const start = text.indexOf(value, containerStart);
    if (start < 0) return;
    const end = start + value.length;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    segments.push({
      type: 'embedded',
      // Astro component scripts always use its TypeScript dialect, including
      // frontmatter without annotations. The exact slice stays authoritative.
      languageId: 'typescript',
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
      const childStart = resolveOffset(pos?.start?.offset);
      const childEnd = resolveOffset(pos?.end?.offset);
      if (childStart === null || childEnd === null) continue;
      if (start == null || childStart < start) start = childStart;
      if (end == null || childEnd > end) end = childEnd;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    const langAttr = node?.attributes?.find?.((attr) => String(attr?.name || '').toLowerCase() === 'lang');
    const languageId = normalizeLanguageHint(extractAstroAttributeValue(langAttr), fallbackLang);
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
  const walk = (node, templateOwner = true) => {
    if (!node || typeof node !== 'object') return;
    // Nested compiler expression ranges can exceed their containing element.
    // An admitted outer node owns the template extent, never its descendants.
    const ownsTemplate = templateOwner && updateTemplateRange(node);
    if (node.type === 'frontmatter') addFrontmatter(node);
    if (node.type === 'element') {
      const name = String(node.name || '').toLowerCase();
      if (name === 'script') addElementBlock(node, 'script', 'javascript');
      if (name === 'style') addElementBlock(node, 'style', 'css');
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, templateOwner && !ownsTemplate);
    }
  };
  for (const child of ast.children) walk(child);
  if (!segments.some((segment) => segment?.meta?.block === 'template')
    && Number.isFinite(templateStart)
    && Number.isFinite(templateEnd)
    && templateEnd > templateStart) {
    segments.push({
      type: 'embedded',
      languageId: 'html',
      start: templateStart,
      end: templateEnd,
      parentSegmentId: null,
      embeddingContext: 'code',
      meta: { block: 'template' }
    });
  }
  return segments.length ? finalizeSegments(segments, relPath) : null;
};
