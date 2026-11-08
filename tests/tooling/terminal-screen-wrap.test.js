import assert from 'node:assert/strict';
import { reconstructTerminalScreen, createTerminalScreen } from '../../tools/testing/terminal-screen.js';

const screen = text => reconstructTerminalScreen(text, { columns: 20, rows: 10 });
assert.deepEqual(screen(`${'a'.repeat(20)}\r\nnext`).lines, ['a'.repeat(20), 'next'],
  'a full row followed by CRLF advances once, without an extra blank row');
const full = Array.from({ length: 10 }, (_, index) => String(index).repeat(20)).join('');
assert.equal(screen(full).lines[0], '0'.repeat(20), 'writing the last cell alone must not scroll the entire screen');
assert.equal(screen(`${full}\x1b[1;1HS\x1b[1Clect`).lines[0], 'S0lect' + '0'.repeat(14),
  'absolute updates retain cells skipped by the real ConPTY differential output');
assert.deepEqual(screen(`a\x1b[99Cb`).lines, [`a${' '.repeat(18)}b`], 'cursor-forward clamps within its row');
assert.deepEqual(screen(`${'x'.repeat(20)}y`).lines, ['x'.repeat(20), 'y'], 'the next printable character triggers delayed wrapping');
assert.deepEqual(screen('C:\\|\bUs|\ber|\bs').lines, ['C:\\Users'],
  'ConPTY backspace updates overwrite the old text-cursor marker without erasing unrelated cells');
assert.deepEqual(screen('\b\bfirst').lines, ['first'], 'backspace clamps at the left margin');
for (const text of [`${full}\x1b[1;1HS\x1b[1Clect`, 'hé😀\r\nnext\x1b[2;3Hnew\x1b[K',
  'a\x1b]0;ignored title\x07b\x1b]0;ignored\x1b\\c\x1b7\x1b[3;4Hother\x1b8d']) {
  for (let split = 0; split <= text.length; split++) {
    const streamed = createTerminalScreen({ columns: 20, rows: 10 });
    streamed.write(text.slice(0, split)); streamed.write(text.slice(split));
    assert.deepEqual(streamed.snapshot(), screen(text), `PTY split at ${split} retains exact full-frame meaning`);
    assert.equal(streamed.metrics().consumedCodeUnits, text.length);
  }
}
const streamed = createTerminalScreen({ columns: 20, rows: 10 });
for (let index = 0; index < 1000; index++) { streamed.write('\x1b[1;1Hsame frame'); streamed.snapshot(); }
assert.equal(streamed.metrics().consumedCodeUnits, 1000 * '\x1b[1;1Hsame frame'.length, 'observing frames never reparses prior PTY output');
assert.deepEqual(streamed.snapshot(), screen('\x1b[1;1Hsame frame'));
console.log('Terminal reconstruction retains delayed auto-wrap, cursor bounds and differential frames');
