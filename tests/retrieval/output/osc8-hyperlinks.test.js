#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildFileHyperlink,
  hyperlinkFileLabel,
  resolveHyperlinkMode
} from '../../../src/retrieval/output/format/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';

const fakeTty = { isTTY: true };
const fakePipe = { isTTY: false };

assert.equal(
  resolveHyperlinkMode({ configuredMode: 'off', stdout: fakeTty }),
  'off',
  'expected explicit config off override'
);
assert.equal(
  resolveHyperlinkMode({ configuredMode: 'auto', env: { TERM_PROGRAM: 'vscode' }, stdout: fakeTty }),
  'vscode',
  'expected VS Code terminals to prefer vscode hyperlinks'
);
assert.equal(
  resolveHyperlinkMode({ env: {}, stdout: fakePipe }),
  'off',
  'expected non-tty output to disable hyperlinks by default'
);

const fileHref = buildFileHyperlink({
  filePath: 'src/app.js',
  line: 12,
  rootDir: 'C:\\Users\\sneak\\Development\\DOUBLECLEAT',
  mode: 'file'
});
assert.match(fileHref, /^file:\/\/\/C:\/Users\/sneak\/Development\/DOUBLECLEAT\/src\/app\.js$/u);

const vscodeHref = buildFileHyperlink({
  filePath: 'src/app.js',
  line: 12,
  column: 3,
  rootDir: 'C:\\Users\\sneak\\Development\\DOUBLECLEAT',
  mode: 'vscode'
});
assert.equal(
  vscodeHref,
  'vscode://file/C:/Users/sneak/Development/DOUBLECLEAT/src/app.js:12:3'
);

const linked = hyperlinkFileLabel({
  label: 'src/app.js',
  filePath: 'src/app.js',
  line: 12,
  rootDir: 'C:\\Users\\sneak\\Development\\DOUBLECLEAT',
  mode: 'file'
});
assert.match(linked, /\x1b\]8;;file:\/\/\/C:\/Users\/sneak\/Development\/DOUBLECLEAT\/src\/app\.js\x1b\\/u);
assert.match(linked, /src\/app\.js/u);
assert.match(linked, /\x1b\]8;;\x1b\\/u);
assert.equal(stripAnsi(linked), 'src/app.js', 'expected visible-width stripping to remove OSC8 escapes');

console.log('osc8 hyperlink helpers test passed');
