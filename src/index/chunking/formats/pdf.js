import {
  buildDocumentAnchor,
  findCoveredUnitRange,
  normalizeDocumentChunkingBudgets,
  splitRangeByCharBudget
} from './document-common.js';

const toPdfPageUnits = (context) => {
  const units = context?.documentExtraction?.units;
  if (!Array.isArray(units)) return [];
  return units
    .filter((unit) => unit?.type === 'pdf')
    .map((unit) => ({
      pageNumber: Number(unit?.pageNumber) || 0,
      start: Number(unit?.start) || 0,
      end: Number(unit?.end) || 0
    }))
    .filter((unit) => unit.pageNumber > 0 && unit.end > unit.start)
    .sort((a, b) => (a.pageNumber - b.pageNumber) || (a.start - b.start));
};

const buildPdfWindows = (pageUnits, budgets) => {
  const windows = [];
  let cursor = 0;
  while (cursor < pageUnits.length) {
    const startIndex = cursor;
    let endIndex = cursor;
    let chars = Math.max(0, pageUnits[cursor].end - pageUnits[cursor].start);
    while (chars < budgets.minCharsPerChunk && endIndex + 1 < pageUnits.length) {
      endIndex += 1;
      chars += Math.max(0, pageUnits[endIndex].end - pageUnits[endIndex].start);
    }
    const startOffset = pageUnits[startIndex].start;
    const endOffset = pageUnits[endIndex].end;
    windows.push({ startOffset, endOffset, startIndex, endIndex });
    cursor = endIndex + 1;
  }
  return windows;
};

const buildPdfChunk = ({ text, pageUnits, startOffset, endOffset, windowIndex = null }) => {
  const pageRange = findCoveredUnitRange({
    units: pageUnits,
    startOffset,
    endOffset,
    startField: 'pageNumber',
    endField: 'pageNumber',
    fallbackStart: pageUnits[0]?.pageNumber || 1,
    fallbackEnd: pageUnits[pageUnits.length - 1]?.pageNumber || 1
  });
  const slice = text.slice(startOffset, endOffset);
  const anchor = buildDocumentAnchor({
    type: 'pdf',
    start: pageRange.start,
    end: pageRange.end,
    textSlice: slice
  });
  return {
    start: startOffset,
    end: endOffset,
    name: pageRange.start === pageRange.end
      ? `Page ${pageRange.start}`
      : `Pages ${pageRange.start}-${pageRange.end}`,
    kind: 'Section',
    meta: {},
    segment: {
      type: 'pdf',
      pageStart: pageRange.start,
      pageEnd: pageRange.end,
      anchor,
      ...(Number.isFinite(windowIndex) ? { windowIndex } : {})
    }
  };
};

export const chunkPdfDocument = (text, context = null) => {
  const value = String(text || '');
  if (!value) return [];
  const pageUnits = toPdfPageUnits(context);
  if (!pageUnits.length) {
    const anchor = buildDocumentAnchor({
      type: 'pdf',
      start: 1,
      end: 1,
      textSlice: value
    });
    return [{
      start: 0,
      end: value.length,
      name: 'Page 1',
      kind: 'Section',
      meta: {},
      segment: {
        type: 'pdf',
        pageStart: 1,
        pageEnd: 1,
        anchor
      }
    }];
  }
  const budgets = normalizeDocumentChunkingBudgets(context);
  const windows = buildPdfWindows(pageUnits, budgets);
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
      chunks.push(buildPdfChunk({
        text: value,
        pageUnits,
        startOffset: split.start,
        endOffset: split.end,
        windowIndex: split.windowIndex
      }));
    }
  }
  return chunks;
};
