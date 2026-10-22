#!/usr/bin/env node
import assert from 'node:assert/strict';
import { displayWidth, truncateLine, stripAnsi, sanitizeDisplayText } from '../../../src/shared/cli/display/text.js';
import { resolveRowCellBudget } from '../../../src/shared/cli/display/layout.js';
import { formatHumanLog } from '../../../src/shared/cli/display/human-log.js';
import { writeDisplayFrame } from '../../../src/shared/cli/display/frame.js';
import { createDisplayState } from '../../../src/shared/cli/display/state.js';

for (const [text, cells] of [['ascii', 5], ['界', 2], ['e\u0301', 1], ['👩‍💻', 2], ['👍🏽', 2], ['🇺🇸', 2], ['1️⃣', 2]]) {
  assert.equal(displayWidth(text), cells, text);
  for (const width of [0, 1, 2, 3, 5, 12]) assert.ok(displayWidth(truncateLine(text.repeat(4), width)) <= width);
}
const styled = '\x1b[38;2;20;30;40m👩‍💻 hello\x1b[0m';
assert.equal(stripAnsi(truncateLine(styled, 2)), '👩‍💻');
assert.ok(truncateLine(styled, 2).endsWith('\x1b[0m'));
assert.equal(displayWidth('\x1b]8;;https://example.test\x07界\x1b]8;;\x07'), 2);
assert.equal(sanitizeDisplayText('one\r\ntwo\tthree\x1b[2J'), 'one two three');
for (const width of [20, 40, 60, 80, 120, 160, 240]) {
  const row = resolveRowCellBudget({ width, fixed: 8, suffix: 3, detail: 8, message: 12 });
  const extras = Object.values(row.fields).reduce((sum, size) => sum + (size ? size + 3 : 0), 0);
  assert.ok(row.barWidth + 8 + 3 + extras <= width);
}
const wide = resolveRowCellBudget({ width: 240, fixed: 20, suffix: 7, rate: 12, detail: 8, message: 30 });
assert.ok(wide.barWidth > 42);
const detailMessage = resolveRowCellBudget({ width: 120, fixed: 15, suffix: 5, detail: 8, message: 20 });
assert.equal(detailMessage.showRate, false);
assert.equal(detailMessage.showDetail, true);
assert.equal(detailMessage.showMessage, true);
const diagnostic = '[watchdog] progress 5/10 (50%) elapsed=30s rate=0.16 files/s oldest=C:\\very long\\' + 'path'.repeat(100);
const summary = formatHumanLog(diagnostic, { width: 240 });
assert.ok(displayWidth(summary) <= 120);
assert.match(summary, /5\/10/);
assert.match(summary, /--progress jsonl/);
assert.equal(diagnostic.includes('oldest='), true, 'canonical diagnostic remains complete');
const literal = [];
const term = value => { if (value.includes('%')) throw new Error('User text reached formatter'); };
term.noFormat = value => literal.push(value);
term.up = () => {};
term.down = () => {};
term.eraseLine = () => {};
writeDisplayFrame({ state: createDisplayState(), term, lines: ['100% %s ^r literal'] });
assert.deepEqual(literal, ['100% %s ^r literal']);
console.log('Display cells, responsive row budgets and literal frame output are consistent.');
