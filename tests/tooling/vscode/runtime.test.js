#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  resolveConfiguredCli,
  parseSearchPayload,
  summarizeProcessFailure,
  openSearchHit
} = require('../../../extensions/vscode/runtime.js');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-runtime-'));

const directCommand = resolveConfiguredCli('C:/repo', 'pairofcleats', ['--verbose'], {
  command: 'pairofcleats',
  jsExtension: '.js'
});
assert.equal(directCommand.ok, true);
assert.equal(directCommand.command, 'pairofcleats');
assert.deepEqual(directCommand.argsPrefix, ['--verbose']);

const missing = resolveConfiguredCli('C:/repo', 'missing/pairofcleats.js', [], {
  command: 'pairofcleats',
  jsExtension: '.js'
});
assert.equal(missing.ok, false);
assert.match(missing.message, /does not exist/i);

const invalidDir = resolveConfiguredCli(tempRoot, '.', [], {
  command: 'pairofcleats',
  jsExtension: '.js'
});
assert.equal(invalidDir.ok, false);
assert.match(invalidDir.message, /not a file/i);

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
      return { scheme: 'file', fsPath: filePath, path: filePath };
    },
    joinPath(base, ...segments) {
      const joined = path.posix.join(base.path || '', ...segments);
      return {
        ...base,
        path: joined,
        fsPath: joined.replace(/\//g, path.sep)
      };
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
  startLine: 4,
  startCol: 3,
  endLine: 4,
  endCol: 12
});
assert.equal(openOk.ok, true);
assert.equal(openOk.filePath, path.join('C:/repo', 'src/index.js'));
assert.equal(revealCalls.length, 1);
assert.equal(revealCalls[0].range.start.line, 3);
assert.equal(revealCalls[0].range.start.character, 2);
assert.equal(revealCalls[0].range.end.character, 11);

const openRemote = await openSearchHit(fakeVscode, {
  repoRoot: null,
  repoUri: { scheme: 'vscode-remote', path: '/workspace/repo', fsPath: '/workspace/repo' }
}, {
  file: 'src/remote.ts',
  startLine: 2,
  startCol: 1,
  endLine: 2,
  endCol: 7
});
assert.equal(openRemote.ok, true);
assert.equal(openRemote.filePath, path.join(path.sep, 'workspace', 'repo', 'src', 'remote.ts'));

const openTraversal = await openSearchHit(fakeVscode, 'C:/repo', {
  file: '../outside.js'
});
assert.equal(openTraversal.ok, false);
assert.match(openTraversal.message, /outside the repo/i);

const navigateFail = await openSearchHit({
  ...fakeVscode,
  window: {
    async showTextDocument() {
      throw new Error('cannot reveal');
    }
  }
}, 'C:/repo', { file: 'src/index.js' });
assert.equal(navigateFail.ok, false);
assert.match(navigateFail.message, /could not navigate/i);
assert.match(navigateFail.detail, /cannot reveal/i);

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
