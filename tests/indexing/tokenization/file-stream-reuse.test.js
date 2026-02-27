#!/usr/bin/env node
import {
  createFileLineTokenStream,
  createTokenizationContext,
  sliceFileLineTokenStream,
  tokenizeChunkText
} from '../../../src/index/build/tokenization.js';

const context = createTokenizationContext({
  dictWords: new Set(['request', 'builder', 'response', 'decode']),
  dictConfig: {},
  postingsConfig: {}
});

const text = [
  'function RequestBuilder() {',
  '  const decoded = parseJSON(response_body);',
  '  return decoded;',
  '}',
  '',
  'const handler = () => decodeResponse(payload);'
].join('\n');

const lineStream = createFileLineTokenStream({
  text,
  mode: 'code',
  ext: '.js',
  dictWords: context.dictWords,
  dictConfig: context.dictConfig
});

const lines = text.split('\n');
const sliceLines = (start, end) => lines.slice(start - 1, end).join('\n');

const ranges = [
  [1, 2],
  [2, 4],
  [6, 6]
];

for (const [startLine, endLine] of ranges) {
  const chunkText = sliceLines(startLine, endLine);
  const pretokenized = sliceFileLineTokenStream({
    stream: lineStream,
    startLine,
    endLine
  });
  const baseline = tokenizeChunkText({
    text: chunkText,
    mode: 'code',
    ext: '.js',
    context
  });
  const reused = tokenizeChunkText({
    text: chunkText,
    mode: 'code',
    ext: '.js',
    context,
    pretokenized
  });

  if (JSON.stringify(baseline.tokens) !== JSON.stringify(reused.tokens)) {
    console.error(`token mismatch for ${startLine}-${endLine}`);
    process.exit(1);
  }
  if (JSON.stringify(baseline.seq) !== JSON.stringify(reused.seq)) {
    console.error(`seq mismatch for ${startLine}-${endLine}`);
    process.exit(1);
  }
  if (JSON.stringify(baseline.tokenIds) !== JSON.stringify(reused.tokenIds)) {
    console.error(`tokenIds mismatch for ${startLine}-${endLine}`);
    process.exit(1);
  }
  if (JSON.stringify(baseline.minhashSig) !== JSON.stringify(reused.minhashSig)) {
    console.error(`minhash mismatch for ${startLine}-${endLine}`);
    process.exit(1);
  }
}

// Regression: very large single-line payloads must not overflow call stack
// when slicing pre-tokenized file-line streams.
const longLine = Array.from({ length: 120000 }, (_, i) => `token_${i}`).join(' ');
const hugeText = `{"docs":"${longLine}"}`;
const hugeStream = createFileLineTokenStream({
  text: hugeText,
  mode: 'prose',
  ext: '.json',
  dictWords: context.dictWords,
  dictConfig: context.dictConfig
});
const hugePretokenized = sliceFileLineTokenStream({
  stream: hugeStream,
  startLine: 1,
  endLine: 1
});
const hugeBaseline = tokenizeChunkText({
  text: hugeText,
  mode: 'prose',
  ext: '.json',
  context
});
const hugeReused = tokenizeChunkText({
  text: hugeText,
  mode: 'prose',
  ext: '.json',
  context,
  pretokenized: hugePretokenized
});
if (JSON.stringify(hugeBaseline.tokens) !== JSON.stringify(hugeReused.tokens)) {
  console.error('token mismatch for huge single-line slice');
  process.exit(1);
}
if (JSON.stringify(hugeBaseline.seq) !== JSON.stringify(hugeReused.seq)) {
  console.error('seq mismatch for huge single-line slice');
  process.exit(1);
}

console.log('tokenization file stream reuse test passed');
