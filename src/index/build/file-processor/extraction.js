import {
  normalizeExtractedText
} from '../../extractors/common.js';

const DOCUMENT_EXTS = new Set(['.pdf', '.docx']);

export const isDocumentExt = (ext) => DOCUMENT_EXTS.has(ext);

/**
 * Normalize an extension into a stable fallback language id token.
 *
 * @param {string} ext
 * @returns {string|null}
 */
export const normalizeFallbackLanguageFromExt = (ext) => {
  const raw = typeof ext === 'string' ? ext.trim().toLowerCase() : '';
  if (!raw) return null;
  const stripped = raw.startsWith('.') ? raw.slice(1) : raw;
  if (!stripped) return null;
  const normalized = stripped.replace(/[^a-z0-9._+-]/g, '');
  return normalized || null;
};

/**
 * Build normalized PDF text plus per-page offsets for downstream chunking.
 *
 * @param {Array<{text?:string,pageNumber?:number}>} pages
 * @returns {{text:string,units:Array<object>,counts:{pages:number,paragraphs:number,totalUnits:number}}}
 */
export const buildPdfExtractionText = (pages) => {
  const units = [];
  let cursor = 0;
  const parts = [];
  for (const page of pages || []) {
    const text = normalizeExtractedText(page?.text || '');
    if (!text) continue;
    const start = cursor;
    parts.push(text);
    cursor += text.length;
    units.push({
      type: 'pdf',
      pageNumber: Number(page?.pageNumber) || units.length + 1,
      start,
      end: cursor,
      text
    });
    parts.push('\n\n');
    cursor += 2;
  }
  if (parts.length >= 2) {
    parts.pop();
    cursor = Math.max(0, cursor - 2);
  }
  return {
    text: parts.join(''),
    units,
    counts: {
      pages: units.length,
      paragraphs: 0,
      totalUnits: units.length
    }
  };
};

/**
 * Build normalized DOCX text plus per-paragraph offsets for chunk attribution.
 *
 * @param {Array<{text?:string,index?:number,style?:string|null}>} paragraphs
 * @returns {{text:string,units:Array<object>,counts:{pages:number,paragraphs:number,totalUnits:number}}}
 */
export const buildDocxExtractionText = (paragraphs) => {
  const units = [];
  let cursor = 0;
  const parts = [];
  for (const paragraph of paragraphs || []) {
    const text = normalizeExtractedText(paragraph?.text || '');
    if (!text) continue;
    const start = cursor;
    parts.push(text);
    cursor += text.length;
    units.push({
      type: 'docx',
      index: Number(paragraph?.index) || units.length + 1,
      style: paragraph?.style || null,
      start,
      end: cursor,
      text
    });
    parts.push('\n\n');
    cursor += 2;
  }
  if (parts.length >= 2) {
    parts.pop();
    cursor = Math.max(0, cursor - 2);
  }
  return {
    text: parts.join(''),
    units,
    counts: {
      pages: 0,
      paragraphs: units.length,
      totalUnits: units.length
    }
  };
};
