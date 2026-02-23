#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createDeterministicFileStreamSampler,
  selectDeterministicFileSample
} from '../../../tools/build/embeddings/sampling.js';
import { toPosix } from '../../../src/shared/files.js';

const buildEntries = (files) => files.map((filePath) => [
  filePath,
  [{ index: 0, chunk: { id: 0, start: 0, end: 1 } }]
]);

const runStreamSampler = ({ files, mode, maxFiles, seed }) => {
  const sampler = createDeterministicFileStreamSampler({ mode, maxFiles, seed });
  const selected = new Set();
  for (const filePath of files) {
    const normalized = toPosix(filePath);
    const decision = sampler.considerFile(filePath);
    if (decision.evicted) {
      selected.delete(decision.evicted);
    }
    if (decision.selected && normalized) {
      selected.add(normalized);
    }
  }
  return {
    selected: Array.from(selected).sort(),
    seen: sampler.getSeenCount(),
    kept: sampler.getSelectedCount()
  };
};

const mode = 'code';
const seed = 'sampling-seed';
const maxFiles = 3;
const baseFiles = [
  'src/a.js',
  'src/b.js',
  'src/c.js',
  'src/d.js',
  'src/e.js',
  'src/f.js'
];

const expected = selectDeterministicFileSample({
  fileEntries: buildEntries(baseFiles),
  mode,
  maxFiles,
  seed
}).map(([filePath]) => toPosix(filePath)).sort();

const streamForward = runStreamSampler({
  files: [...baseFiles],
  mode,
  maxFiles,
  seed
});
assert.deepEqual(streamForward.selected, expected, 'stream sampler should match batch deterministic sample');
assert.equal(streamForward.seen, baseFiles.length, 'seen file count mismatch');
assert.equal(streamForward.kept, maxFiles, 'selected file count mismatch');

const reverseWithRepeats = runStreamSampler({
  files: [...baseFiles].reverse().concat(['src/a.js', 'src/d.js', 'src/f.js']),
  mode,
  maxFiles,
  seed
});
assert.deepEqual(
  reverseWithRepeats.selected,
  expected,
  'stream sampler should remain deterministic across order/repeats'
);

const keepAll = runStreamSampler({
  files: ['src/a.js', 'src/b.js'],
  mode,
  maxFiles: 10,
  seed
});
assert.deepEqual(keepAll.selected, ['src/a.js', 'src/b.js'], 'maxFiles above file count should keep all files');

console.log('deterministic file sampling test passed');
