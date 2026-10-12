#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { createProgressLineDecoder } from '../../../src/shared/cli/progress-stream.js';
import { formatProgressEvent } from '../../../src/shared/cli/progress-events.js';

const event = formatProgressEvent('log', { file: 'src/🙂.js', message: '你好' });
const line = JSON.stringify(event) + '\n';
const splitIndex = Buffer.from(line).indexOf(Buffer.from('🙂')) + 2;
const decoded = [];
const progress = createProgressLineDecoder({ maxLineBytes: 512, onLine: value => decoded.push(value) });
const source = `const bytes = Buffer.from(${JSON.stringify(line)});process.stdout.write(bytes.subarray(0,${splitIndex}));setTimeout(() => process.stdout.write(bytes.subarray(${splitIndex})), 10);`;
let streamed = '';
const result = await spawnSubprocess(process.execPath, ['-e', source], {
  stdio: ['ignore', 'pipe', 'ignore'], timeoutMs: 5000,
  onStdout: text => { assert.equal(typeof text, 'string'); streamed += text; progress.push(text); }
});
progress.flush();
assert.equal(streamed, line, 'valid UTF8 split across real pipe chunks reaches callbacks without replacement fragments');
assert.equal(result.stdout, line);
assert.equal(decoded.length, 1);
assert.deepEqual(decoded[0].event, event);

const overflow = [], boundedLines = [];
const bounded = createProgressLineDecoder({ maxLineBytes: 7,
  onOverflow: value => overflow.push(value), onLine: value => boundedLines.push(value) });
await spawnSubprocess(process.execPath, ['-e', "process.stdout.write('🙂'.repeat(2048) + '\\n')"], {
  stdio: ['ignore', 'pipe', 'ignore'], captureStdout: false, timeoutMs: 5000,
  onStdout: text => bounded.push(text)
});
bounded.flush();
assert.equal(boundedLines.length, 1);
assert.ok(Buffer.byteLength(boundedLines[0].line) <= 7, 'a complete oversized line is bounded before emission');
assert.equal(boundedLines[0].line.includes('\ufffd'), false);
assert.equal(boundedLines[0].truncated, true);
assert.equal(boundedLines[0].event, null);
assert.equal(overflow.reduce((sum, entry) => sum + entry.overflowBytes, 0), 8192 - Buffer.byteLength(boundedLines[0].line));

const suffixes = [];
const suffix = createProgressLineDecoder({ maxLineBytes: Buffer.byteLength(line) + 8, onLine: value => suffixes.push(value) });
suffix.push(' '.repeat(1024)); suffix.push(line); suffix.flush();
assert.equal(suffixes[0].event, null, 'a parseable JSON tail from a truncated line never becomes a complete progress frame');
assert.equal(suffixes[0].truncated, true);

let eofText = '';
await spawnSubprocess(process.execPath, ['-e', "process.stdout.write(Buffer.from([0xe2, 0x82]))"], {
  stdio: ['ignore', 'pipe', 'ignore'], timeoutMs: 5000,
  onStdout: text => { eofText += text; }
});
assert.equal(eofText, '\ufffd', 'EOF flush resolves incomplete UTF8 only when the stream ends');
const crlf = [];
const crlfDecoder = createProgressLineDecoder({ onLine: value => crlf.push(value.line) });
crlfDecoder.push('one\r'); crlfDecoder.push('\ntwo\r'); crlfDecoder.flush();
assert.deepEqual(crlf, ['one', 'two'], 'split CRLF is one delimiter');
console.log('Real subprocess UTF8 progress, complete-line admission and incomplete EOF decoding pass.');
