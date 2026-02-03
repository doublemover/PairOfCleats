#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveTreeSitterPreloadPlan } from '../../../src/index/build/indexer/steps/process-files/tree-sitter.js';

const entries = [
  { treeSitterBatchLanguages: ['javascript', 'html'] },
  { treeSitterBatchLanguages: ['javascript'] },
  { treeSitterBatchLanguages: ['python'] },
  { treeSitterBatchLanguages: ['html'] }
];

const plan = resolveTreeSitterPreloadPlan(entries, { maxLoadedLanguages: 3 });
assert.deepStrictEqual(
  plan.languages,
  ['javascript', 'html', 'python'],
  'preload order should sort by frequency desc, then language id'
);

const limited = resolveTreeSitterPreloadPlan(entries, { maxLoadedLanguages: 2 });
assert.deepStrictEqual(
  limited.languages,
  ['javascript', 'html'],
  'preload plan should respect maxLoadedLanguages'
);

console.log('tree-sitter preload order deterministic ok');
