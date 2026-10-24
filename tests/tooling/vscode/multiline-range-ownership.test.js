import assert from 'node:assert/strict';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
const root = createVsCodeRuntimeTempRepo({ prefix: 'editor-range-ownership-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root });
try {
  let selection, revealed;
  harness.fakeVscode.window.showTextDocument = async document => ({
    document,
    set selection(value) { selection = value; }, revealRange(range) { revealed = range; }
  });
  const repo = { repoRoot: root, repoUri: harness.fakeVscode.Uri.file(root) };
  for (const [startLine, startCol, endLine, endCol, expectedCol] of [
    [4, 10, 6, 2, 1], [4, 10, 6, 10, 9], [4, 10, 6, 15, 14], [4, 10, 6, 1, 0],
    [4, 10, 4, 15, 14], [4, 10, 4, 2, 9], [4, 10, 6, undefined, 0]
  ]) {
    const hit = { file: 'src/app.ts', startLine, startCol, endLine, endCol };
    const locationRange = harness.extension._test.createRangeFromNavigationEntry(hit);
    assert.equal(locationRange.start.line, startLine - 1);
    assert.equal(locationRange.start.character, startCol - 1);
    assert.equal(locationRange.end.line, endLine - 1);
    assert.equal(locationRange.end.character, expectedCol);
    const opened = await harness.extension._test.openSearchHit(harness.fakeVscode, repo, hit);
    assert.equal(opened.ok, true);
    assert.equal(revealed.end.character, expectedCol);
    assert.ok(selection);
  }
  assert.equal(harness.extension._test.createRangeFromNavigationEntry({ startLine: 0 }), null);
  assert.equal(harness.extension._test.createRangeFromNavigationEntry({}), null);
  assert.equal(path.isAbsolute(root), true);
} finally { harness.restoreGlobals(); }
console.log('Search selection/reveal and navigation preserve multiline end positions');
