#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildFileHyperlink,
  hyperlinkFileLabel,
  hyperlinkText,
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

assert.equal(buildFileHyperlink({ filePath: 'src/a #?%.js', rootDir: 'C:\\repo', mode: 'file' }),
  'file:///C:/repo/src/a%20%23%3F%25.js');
assert.equal(buildFileHyperlink({ filePath: 'D:\\other\\a.js', rootDir: 'C:\\repo', mode: 'file' }),
  'file:///D:/other/a.js');
assert.equal(buildFileHyperlink({ filePath: 'src/a.js', rootDir: '\\\\files.example\\share\\repo', mode: 'file' }),
  'file://files.example/share/repo/src/a.js', 'UNC authority is preserved, not replaced with the local hostname');
assert.equal(buildFileHyperlink({ filePath: 'src/a\\b #?.js', rootDir: '/workspace/repo', mode: 'file' }),
  'file:///workspace/repo/src/a%5Cb%20%23%3F.js', 'POSIX backslashes remain filename characters');
assert.equal(buildFileHyperlink({ filePath: '/workspace/actual.js', rootDir: 'C:\\repo', mode: 'file' }),
  'file:///workspace/actual.js', 'an explicit POSIX absolute path keeps POSIX semantics');
assert.equal(buildFileHyperlink({ filePath: 'a #?%.js', rootDir: '/workspace/repo', mode: 'vscode' }),
  'vscode://file//workspace/repo/a%20%23%3F%25.js', 'reserved URI characters do not become a fragment or query');
assert.equal(buildFileHyperlink({ filePath: 'a.js', rootDir: '/workspace/repo', mode: 'vscode', line: 4, column: 0 }),
  'vscode://file//workspace/repo/a.js:4:1');
const dangerous = '\x1b]52;c;Y29weQ==\x07unsafe\u202e\x00';
const safeLabel = hyperlinkText(dangerous, 'file:///workspace/a.js');
assert.doesNotMatch(safeLabel, /\x1b\]52|\u202e|\x00/);
assert.equal(hyperlinkText('label', `file:///workspace/${dangerous}`), 'label', 'unsafe raw targets are not emitted');
const encodedTarget = buildFileHyperlink({ filePath: dangerous, rootDir: '/workspace/repo', mode: 'file' });
assert.doesNotMatch(encodedTarget, /[\x00-\x1f\u202e]/u);
assert.match(encodedTarget, /%1B/);
assert.equal(hyperlinkText('\x1b[1mfile\x1b[0m', null), '\x1b[1mfile\x1b[0m', 'safe label styling survives');

console.log('osc8 hyperlink helpers test passed');
