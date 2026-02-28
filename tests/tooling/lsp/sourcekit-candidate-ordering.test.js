#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  compareSourcekitCandidatePriority,
  scoreSourcekitCandidate
} from '../../../src/index/tooling/sourcekit-provider.js';

const makeEntry = (candidate, index) => ({
  candidate,
  index,
  score: scoreSourcekitCandidate(candidate)
});

const candidates = [
  makeEntry('/z/toolchains/sourcekit-lsp', 0),
  makeEntry('/opt/toolchains/sourcekit-lsp-preview', 1),
  makeEntry('/opt/toolchains/sourcekit-lsp+asserts', 2),
  makeEntry('/a/toolchains/sourcekit-lsp', 3)
];

const sorted = candidates
  .slice()
  .sort(compareSourcekitCandidatePriority)
  .map((entry) => entry.candidate);
assert.deepEqual(sorted, [
  '/opt/toolchains/sourcekit-lsp+asserts',
  '/opt/toolchains/sourcekit-lsp-preview',
  '/a/toolchains/sourcekit-lsp',
  '/z/toolchains/sourcekit-lsp'
], 'expected deterministic score-first then lexical candidate ordering');

const alternateInputOrder = [
  candidates[3],
  candidates[0],
  candidates[2],
  candidates[1]
];
const alternateSorted = alternateInputOrder
  .slice()
  .sort(compareSourcekitCandidatePriority)
  .map((entry) => entry.candidate);
assert.deepEqual(
  alternateSorted,
  sorted,
  'expected candidate ordering to remain deterministic regardless of discovery order'
);

console.log('sourcekit candidate ordering test passed');
