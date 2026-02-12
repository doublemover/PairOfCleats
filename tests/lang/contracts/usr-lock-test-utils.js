import assert from 'node:assert/strict';

export const extractSection = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end marker: ${endMarker}`);
  return text.slice(start, end);
};

export const extractHeadingSection = (text, heading) => {
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing section marker: ${marker}`);
  const fromMarker = text.slice(start + marker.length);
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

export const assertTestsPresent = (
  testIds,
  context,
  ciOrderText,
  ciLiteOrderText,
  options = {}
) => {
  const { requireCiLite = true } = options;
  for (const testId of testIds) {
    assert.equal(ciOrderText.includes(testId), true, `ci order missing ${context} dependency: ${testId}`);
    if (requireCiLite) {
      assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing ${context} dependency: ${testId}`);
    }
  }
};
