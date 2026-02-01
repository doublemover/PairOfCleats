#!/usr/bin/env node
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../../src/shared/jsonrpc.js';
import { flattenSymbols } from '../../../src/integrations/tooling/lsp/symbols.js';
import { rangeToOffsets } from '../../../src/integrations/tooling/lsp/positions.js';

const messages = [];
const errors = [];
const parser = createFramedJsonRpcParser({
  onMessage: (msg) => messages.push(msg),
  onError: (err) => errors.push(err)
});

const waitFor = async (count) => {
  for (let i = 0; i < 50; i += 1) {
    if (messages.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${count} messages.`);
};

const msgOne = { jsonrpc: '2.0', id: 1, result: 'ok' };
const msgTwo = { jsonrpc: '2.0', method: 'notify', params: { ok: true } };

const frame = (payload) => {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = `Content-Length: ${body.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'utf8'), body]);
};

const combined = Buffer.concat([frame(msgOne), frame(msgTwo)]);
parser.push(combined.slice(0, 12));
parser.push(combined.slice(12));

await waitFor(2);
assert.equal(errors.length, 0);
assert.equal(messages.length, 2);
assert.deepEqual(messages[0], msgOne);
assert.deepEqual(messages[1], msgTwo);

const capture = new PassThrough();
const capturedChunks = [];
capture.on('data', (chunk) => capturedChunks.push(chunk));
await writeFramedJsonRpc(capture, msgOne);
const parserTwo = createFramedJsonRpcParser({
  onMessage: (msg) => messages.push(msg),
  onError: (err) => errors.push(err)
});
parserTwo.push(Buffer.concat(capturedChunks));
await waitFor(3);
assert.deepEqual(messages[messages.length - 1], msgOne);

const largeMessages = [];
const largeErrors = [];
const parserLarge = createFramedJsonRpcParser({
  onMessage: (msg) => largeMessages.push(msg),
  onError: (err) => largeErrors.push(err)
});
const largePayload = {
  jsonrpc: '2.0',
  id: 99,
  result: 'x'.repeat(512 * 1024)
};
const largeFrame = frame(largePayload);
for (let i = 0; i < largeFrame.length; i += 1024) {
  parserLarge.push(largeFrame.slice(i, i + 1024));
}
for (let i = 0; i < 50; i += 1) {
  if (largeMessages.length) break;
  await new Promise((resolve) => setTimeout(resolve, 0));
}
assert.equal(largeErrors.length, 0);
assert.equal(largeMessages.length, 1);
assert.equal(largeMessages[0].id, 99);

const docSymbols = [
  {
    name: 'Widget',
    kind: 5,
    detail: 'class Widget',
    range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } },
    selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
    children: [
      {
        name: 'render',
        kind: 6,
        detail: 'func render()',
        range: { start: { line: 1, character: 2 }, end: { line: 2, character: 0 } },
        selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } }
      }
    ]
  }
];

const flattenedDoc = flattenSymbols(docSymbols);
assert.equal(flattenedDoc.length, 2);
assert.equal(flattenedDoc[1].fullName, 'Widget.render');

const infoSymbols = [
  {
    name: 'makeWidget',
    kind: 12,
    containerName: 'Factory',
    location: {
      uri: 'file:///tmp/example.swift',
      range: { start: { line: 5, character: 0 }, end: { line: 7, character: 0 } }
    }
  }
];

const flattenedInfo = flattenSymbols(infoSymbols);
assert.equal(flattenedInfo.length, 1);
assert.equal(flattenedInfo[0].fullName, 'Factory.makeWidget');

const text = 'alpha\nbeta\ngamma';
const lineIndex = buildLineIndex(text);
const offsets = rangeToOffsets(lineIndex, {
  start: { line: 0, character: 1 },
  end: { line: 1, character: 2 }
});
assert.equal(offsets.start, 1);
assert.equal(offsets.end, lineIndex[1] + 2);

const crlfText = 'alpha\r\nbeta\r\ngamma';
const crlfIndex = buildLineIndex(crlfText);
assert.equal(crlfIndex[1], 7);
assert.equal(crlfIndex[2], 13);
const crlfOffsets = rangeToOffsets(crlfIndex, {
  start: { line: 1, character: 1 },
  end: { line: 1, character: 4 }
});
assert.equal(crlfOffsets.start, crlfIndex[1] + 1);
assert.equal(crlfOffsets.end, crlfIndex[1] + 4);

const emojiText = 'a😀b';
const emojiIndex = buildLineIndex(emojiText);
const emojiOffsets = rangeToOffsets(emojiIndex, {
  start: { line: 0, character: 3 },
  end: { line: 0, character: 4 }
});
assert.equal(emojiOffsets.start, 3);
assert.equal(emojiOffsets.end, 4);

console.log('tooling LSP utils test passed');
