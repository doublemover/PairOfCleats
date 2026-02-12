import assert from 'node:assert/strict';

export const extractSection = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end marker: ${endMarker}`);
  return text.slice(start, end);
};

export const checklistLineState = (section, label) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^- \\[x\\] ${escaped}$`, 'm').test(section)) return 'checked';
  if (new RegExp(`^- \\[ \\] ${escaped}$`, 'm').test(section)) return 'unchecked';
  assert.fail(`missing checklist line: ${label}`);
};

export const hasUnchecked = (section) => /- \[ \] /.test(section);

export const assertTestsPresent = (testIds, context, ciOrderText, ciLiteOrderText) => {
  for (const testId of testIds) {
    assert.equal(ciOrderText.includes(testId), true, `ci order missing ${context} dependency: ${testId}`);
    assert.equal(ciLiteOrderText.includes(testId), true, `ci-lite order missing ${context} dependency: ${testId}`);
  }
};
