#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveConfiguredCli,
  parseSearchPayload,
  summarizeProcessFailure,
  openSearchHit
} = require('../../../extensions/vscode/runtime.js');

const missing = resolveConfiguredCli('C:/repo', 'missing/pairofcleats.js', [], {
  command: 'pairofcleats',
  jsExtension: '.js'
});
assert.equal(missing.ok, false);
assert.match(missing.message, /does not exist/i);

const timeout = summarizeProcessFailure({
  code: null,
  timedOut: true,
  cancelled: false,
  stderr: '',
  stdout: '',
  stdoutTruncated: false,
  stderrTruncated: false,
  timeoutMs: 60000
});
assert.equal(timeout.kind, 'timeout');

const cancelled = summarizeProcessFailure({
  code: null,
  timedOut: false,
  cancelled: true,
  stderr: '',
  stdout: '',
  stdoutTruncated: false,
  stderrTruncated: false,
  timeoutMs: 60000
});
assert.equal(cancelled.kind, 'cancelled');

const nonzero = summarizeProcessFailure({
  code: 7,
  timedOut: false,
  cancelled: false,
  stderr: 'boom',
  stdout: '',
  stdoutTruncated: false,
  stderrTruncated: true,
  timeoutMs: 60000
});
assert.equal(nonzero.kind, 'nonzero-exit');
assert.match(nonzero.detail, /\[output truncated\]/);

const truncated = summarizeProcessFailure({
  code: 0,
  timedOut: false,
  cancelled: false,
  stderr: '',
  stdout: '{"incomplete"',
  stdoutTruncated: true,
  stderrTruncated: false,
  timeoutMs: 60000
});
assert.equal(truncated.kind, 'truncated-output');

assert.equal(
  summarizeProcessFailure({
    code: 0,
    timedOut: false,
    cancelled: false,
    stderr: 'warning',
    stdout: '{"ok":true}',
    stdoutTruncated: false,
    stderrTruncated: true,
    timeoutMs: 60000
  }),
  null
);

const parsedOk = parseSearchPayload('{"code":[{"file":"a.js"}]}');
assert.equal(parsedOk.ok, true);

const parsedBad = parseSearchPayload('{"broken"', { stdoutTruncated: false });
assert.equal(parsedBad.ok, false);
assert.equal(parsedBad.kind, 'invalid-json');

const parsedTruncated = parseSearchPayload('{"code":[', { stdoutTruncated: true });
assert.equal(parsedTruncated.ok, false);
assert.equal(parsedTruncated.kind, 'stdout-truncated');

const revealCalls = [];
const fakeVscode = {
  workspace: {
    async openTextDocument(uri) {
      return { uri };
    }
  },
  window: {
    async showTextDocument() {
      return {
        selection: null,
        revealRange(range, mode) {
          revealCalls.push({ range, mode });
        }
      };
    }
  },
  Uri: {
    file(filePath) {
      return { fsPath: filePath };
    }
  },
  Position: class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  Selection: class Selection {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  TextEditorRevealType: {
    InCenter: 'center'
  }
};

const openOk = await openSearchHit(fakeVscode, 'C:/repo', {
  file: 'src/index.js',
  startLine: 4
});
assert.equal(openOk.ok, true);
assert.equal(openOk.filePath, 'C:\\repo\\src\\index.js'.replace(/\\/g, require('node:path').sep));
assert.equal(revealCalls.length, 1);

const openFail = await openSearchHit({
  ...fakeVscode,
  workspace: {
    async openTextDocument() {
      throw new Error('missing file');
    }
  }
}, 'C:/repo', { file: 'missing.js' });
assert.equal(openFail.ok, false);
assert.match(openFail.message, /could not open/i);
assert.match(openFail.detail, /missing file/i);

console.log('vscode runtime contract test passed');
