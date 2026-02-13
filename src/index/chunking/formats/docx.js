import {
  buildDocumentAnchor,
  findCoveredUnitRange,
  normalizeDocumentChunkingBudgets,
  splitRangeByCharBudget
} from './document-common.js';

const HEADING_PATTERN = /heading[\s_-]*([1-9][0-9]*)/i;

const toDocxParagraphUnits = (context) => {
  const units = context?.documentExtraction?.units;
  if (!Array.isArray(units)) return [];
  return units
    .filter((unit) => unit?.type === 'docx')
    .map((unit) => ({
      index: Number(unit?.index) || 0,
      style: unit?.style || null,
      start: Number(unit?.start) || 0,
      end: Number(unit?.end) || 0
    }))
    .filter((unit) => unit.index > 0 && unit.end > unit.start)
    .sort((a, b) => (a.index - b.index) || (a.start - b.start));
};

const resolveHeadingLevel = (style) => {
  if (!style) return null;
  const match = String(style).match(HEADING_PATTERN);
  if (!match) return null;
  const level = Number(match[1]);
  return Number.isFinite(level) && level > 0 ? level : null;
};

const updateHeadingPath = (stack, level, label) => {
  const next = stack.slice(0, Math.max(0, level - 1));
  next[level - 1] = label;
  return next;
};

const toHeadingLabel = (text) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 120) || 'Heading';
};

const buildParagraphWindows = (text, paragraphUnits, budgets) => {
  const windows = [];
  let headingStack = [];
  let current = null;
  const flushCurrent = () => {
    if (!current || current.endOffset <= current.startOffset) return;
    windows.push(current);
    current = null;
  };
  for (const paragraph of paragraphUnits) {
    const paragraphLength = Math.max(0, paragraph.end - paragraph.start);
    const headingLevel = resolveHeadingLevel(paragraph.style);
    if (headingLevel && current) {
      flushCurrent();
    }
    if (headingLevel) {
      const headingText = text.slice(paragraph.start, paragraph.end);
      headingStack = updateHeadingPath(headingStack, headingLevel, toHeadingLabel(headingText));
    }
    if (!current) {
      current = {
        startOffset: paragraph.start,
        endOffset: paragraph.end,
        paragraphStart: paragraph.index,
        paragraphEnd: paragraph.index,
        headingPath: headingStack.filter(Boolean),
        chars: paragraphLength
      };
    } else {
      current.endOffset = paragraph.end;
      current.paragraphEnd = paragraph.index;
      current.chars += paragraphLength;
    }
    if (current.chars >= budgets.maxCharsPerChunk) {
      flushCurrent();
      continue;
    }
    if (current.chars >= budgets.minCharsPerChunk) {
      continue;
    }
  }
  flushCurrent();
  return windows;
};

const buildDocxChunk = ({
  text,
  paragraphUnits,
  startOffset,
  endOffset,
  headingPath,
  windowIndex = null
}) => {
  const paragraphRange = findCoveredUnitRange({
    units: paragraphUnits,
    startOffset,
    endOffset,
    startField: 'index',
    endField: 'index',
    fallbackStart: paragraphUnits[0]?.index || 1,
    fallbackEnd: paragraphUnits[paragraphUnits.length - 1]?.index || 1
  });
  const slice = text.slice(startOffset, endOffset);
  const anchor = buildDocumentAnchor({
    type: 'docx',
    start: paragraphRange.start,
    end: paragraphRange.end,
    textSlice: slice
  });
  const segmentUid = `segdoc:v1:${anchor}`;
  const merged = paragraphRange.start !== paragraphRange.end;
  return {
    start: startOffset,
    end: endOffset,
    name: paragraphRange.start === paragraphRange.end
      ? `Paragraph ${paragraphRange.start}`
      : `Paragraphs ${paragraphRange.start}-${paragraphRange.end}`,
    kind: 'Section',
    meta: {},
    segment: {
      segmentId: segmentUid,
      segmentUid,
      type: 'docx',
      start: startOffset,
      end: endOffset,
      paragraphStart: paragraphRange.start,
      paragraphEnd: paragraphRange.end,
      ...(Array.isArray(headingPath) && headingPath.length ? { headingPath } : {}),
      anchor,
      ...(merged ? { boundaryLabel: 'merged_paragraphs' } : {}),
      ...(Number.isFinite(windowIndex) ? { windowIndex } : {})
    }
  };
};

export const chunkDocxDocument = (text, context = null) => {
  const value = String(text || '');
  if (!value) return [];
  const paragraphUnits = toDocxParagraphUnits(context);
  if (!paragraphUnits.length) {
    const anchor = buildDocumentAnchor({
      type: 'docx',
      start: 1,
      end: 1,
      textSlice: value
    });
    const segmentUid = `segdoc:v1:${anchor}`;
    return [{
      start: 0,
      end: value.length,
      name: 'Paragraph 1',
      kind: 'Section',
      meta: {},
      segment: {
        segmentId: segmentUid,
        segmentUid,
        type: 'docx',
        start: 0,
        end: value.length,
        paragraphStart: 1,
        paragraphEnd: 1,
        anchor
      }
    }];
  }
  const budgets = normalizeDocumentChunkingBudgets(context);
  const windows = buildParagraphWindows(value, paragraphUnits, budgets);
  const chunks = [];
  for (const window of windows) {
    const splits = splitRangeByCharBudget({
      start: window.startOffset,
      end: window.endOffset,
      maxCharsPerChunk: budgets.maxCharsPerChunk,
      minCharsPerChunk: budgets.minCharsPerChunk
    });
    if (!splits.length) continue;
    for (const split of splits) {
      chunks.push(buildDocxChunk({
        text: value,
        paragraphUnits,
        startOffset: split.start,
        endOffset: split.end,
        headingPath: window.headingPath,
        windowIndex: split.windowIndex
      }));
    }
  }
  return chunks;
};
