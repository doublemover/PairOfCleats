import assert from 'node:assert/strict';
import { reconstructTerminalScreen } from '../../tools/testing/terminal-screen.js';

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
console.log('Terminal reconstruction retains delayed auto-wrap, cursor bounds and differential frames');
