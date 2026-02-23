#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildNormalizedChunkPayloadHash,
  compactChunkForEmbeddings
} from '../../../tools/build/embeddings/runner.js';

const compact = compactChunkForEmbeddings({
  id: 7,
  start: 10,
  end: 25,
  file: 'src/example.js',
  text: 'const value = 1;\r\nvalue += 1;\r\n',
  docmeta: { doc: 'doc text' },
  kind: 'function',
  name: 'example'
}, 'src/example.js');

assert.ok(compact, 'expected compact chunk payload');
assert.equal(
  compact.text,
  'const value = 1;\r\nvalue += 1;\r\n',
  'expected compact chunk to preserve inline text when present in chunk_meta'
);

const compactEmptyText = compactChunkForEmbeddings({
  id: 8,
  start: 0,
  end: 0,
  text: ''
}, 'src/empty.js');
assert.equal(
  compactEmptyText.text,
  '',
  'expected compact chunk to preserve empty-string text payloads'
);

const hashLf = buildNormalizedChunkPayloadHash({
  codeText: 'alpha\nbeta',
  docText: 'gamma\ndelta'
});
const hashCrlf = buildNormalizedChunkPayloadHash({
  codeText: 'alpha\r\nbeta',
  docText: 'gamma\r\ndelta'
});
assert.equal(
  hashLf,
  hashCrlf,
  'expected normalized chunk payload hash to ignore CRLF/LF line ending differences'
);

const hashDifferent = buildNormalizedChunkPayloadHash({
  codeText: 'alpha\nbeta!',
  docText: 'gamma\ndelta'
});
assert.notEqual(
  hashLf,
  hashDifferent,
  'expected normalized chunk payload hash to change when payload text changes'
);

console.log('chunk meta inline text test passed');
