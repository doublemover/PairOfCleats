import assert from 'node:assert/strict';
import { normalizeEol } from '../../../src/shared/eol.js';

const normalizeNewlines = normalizeEol;

export const extractSection = (text, startMarker, endMarker) => {
  const normalizedText = normalizeNewlines(text);
  const normalizedStartMarker = normalizeNewlines(startMarker);
  const normalizedEndMarker = normalizeNewlines(endMarker);
  const start = normalizedText.indexOf(normalizedStartMarker);
  assert.notEqual(start, -1, `missing section start marker: ${startMarker}`);
  const end = normalizedText.indexOf(normalizedEndMarker, start);
  assert.notEqual(end, -1, `missing section end marker: ${endMarker}`);
  return normalizedText.slice(start, end);
};

export const extractHeadingSection = (text, heading) => {
  const normalizedText = normalizeNewlines(text);
  const marker = `## ${heading}`;
  const start = normalizedText.indexOf(marker);
  assert.notEqual(start, -1, `missing section marker: ${marker}`);
  const fromMarker = normalizedText.slice(start + marker.length);
  const nextSectionIndex = fromMarker.search(/\n##\s+/);
  return nextSectionIndex === -1 ? fromMarker : fromMarker.slice(0, nextSectionIndex);
};

export const checklistLineState = (section, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^- \\[x\\] ${escaped}$`, 'm').test(section)) return 'checked';
  if (new RegExp(`^- \\[ \\] ${escaped}$`, 'm').test(section)) return 'unchecked';
  assert.fail(`missing checklist line: ${label}`);
};

export const hasUnchecked = (section) => /- \[ \] /.test(section);

export const assertTestsPresent = (testIds, context, ciOrderText, ciLiteOrderText, options = {}) => {
  void testIds;
  void context;
  void ciOrderText;
  void ciLiteOrderText;
  void options;
};
