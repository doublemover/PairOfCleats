import { parse as parseAstro } from '@astrojs/compiler/sync';
import { parse as parseSvelte } from 'svelte/compiler';
import { parse as parseVue } from '@vue/compiler-sfc';
import { normalizeLanguageHint } from './config.js';
import { finalizeSegments } from './finalize.js';

export const segmentVue = ({ text, relPath }) => {
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

export const segmentAstro = ({ text, relPath }) => {
  let ast = null;
  try {
    const result = parseAstro(text);
    ast = result?.ast || null;
  } catch {
    return null;
  }
  if (!ast || !Array.isArray(ast.children)) return null;
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
    if (node.type === 'frontmatter' || node.type === 'root' || node.type === 'fragment') return;
    const pos = node.position;
    const start = pos?.start?.offset;
    const end = pos?.end?.offset;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    if (templateStart == null || start < templateStart) templateStart = start;
    if (templateEnd == null || end > templateEnd) templateEnd = end;
  };
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
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'frontmatter') addFrontmatter(node);
    if (node.type === 'element') {
      const name = String(node.name || '').toLowerCase();
      if (name === 'script') addElementBlock(node, 'script', 'javascript');
      if (name === 'style') addElementBlock(node, 'style', 'css');
      updateTemplateRange(node);
    } else {
      updateTemplateRange(node);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
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
