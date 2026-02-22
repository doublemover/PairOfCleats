#!/usr/bin/env node
import assert from 'node:assert/strict';

import { smartChunk } from '../../../src/index/chunking.js';
import { resolveChunkingFileRole, resolveChunkingLimits } from '../../../src/index/chunking/limits.js';

const countLines = (value) => {
  if (!value) return 0;
  const trimmed = value.endsWith('\n') ? value.slice(0, -1) : value;
  return trimmed ? trimmed.split('\n').length : 0;
};

const text = Array.from({ length: 10 }, (_, index) => `line-${index + 1}`).join('\n') + '\n';

const chunking = {
  languageRoleLimits: {
    typescript: {
      src: { maxLines: 4 },
      test: { maxLines: 2 }
    },
    docs: { maxLines: 6 },
    config: { maxLines: 3 }
  },
  maxLines: 20
};

const testContext = {
  chunking,
  languageId: 'typescript'
};
const srcContext = {
  chunking,
  languageId: 'typescript'
};

const testChunks = smartChunk({
  text,
  ext: '.ts',
  relPath: 'tests/unit/example.test.ts',
  mode: 'code',
  context: testContext
});
const srcChunks = smartChunk({
  text,
  ext: '.ts',
  relPath: 'src/example.ts',
  mode: 'code',
  context: srcContext
});

assert.ok(testChunks.length > srcChunks.length, 'expected tighter chunking for test role');
for (const chunk of testChunks) {
  const lineCount = countLines(text.slice(chunk.start, chunk.end));
  assert.ok(lineCount <= 2, `expected test chunk <=2 lines, got ${lineCount}`);
}
for (const chunk of srcChunks) {
  const lineCount = countLines(text.slice(chunk.start, chunk.end));
  assert.ok(lineCount <= 4, `expected src chunk <=4 lines, got ${lineCount}`);
}

assert.equal(
  resolveChunkingFileRole({ relPath: 'tests/unit/example.test.ts', ext: '.ts', mode: 'code' }),
  'test',
  'expected test role from path'
);
assert.equal(
  resolveChunkingFileRole({ relPath: 'docs/guide.md', ext: '.md', mode: 'prose' }),
  'docs',
  'expected docs role from prose mode/path'
);
assert.equal(
  resolveChunkingFileRole({ relPath: 'config/build.yaml', ext: '.yaml', mode: 'code' }),
  'config',
  'expected config role from path/extension'
);

const docsLimits = resolveChunkingLimits({
  relPath: 'docs/guide.md',
  ext: '.md',
  mode: 'prose',
  chunking: {
    maxLines: 50,
    languageRoleLimits: {
      docs: { maxLines: 6 }
    }
  }
});
assert.equal(docsLimits.maxLines, 6, 'expected docs role override to tighten line budget');

console.log('language role chunking test passed');
