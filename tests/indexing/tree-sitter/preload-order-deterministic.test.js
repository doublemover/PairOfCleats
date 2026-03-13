#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveTreeSitterPreloadPlan } from '../../../src/index/build/indexer/steps/process-files/tree-sitter.js';

const entries = [
  { treeSitterBatchLanguages: ['javascript', 'html'] },
  { treeSitterBatchLanguages: ['javascript'] },
  { treeSitterBatchLanguages: ['python'] },
  { treeSitterBatchLanguages: ['html'] }
];

const plan = resolveTreeSitterPreloadPlan(entries);
assert.deepStrictEqual(
  plan.languages,
  ['html', 'javascript', 'python'],
  'preload order should sort by frequency desc, then language id'
);

console.log('tree-sitter preload order deterministic ok');

