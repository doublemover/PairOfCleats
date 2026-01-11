#!/usr/bin/env node
import { resolveTokenMode } from '../../src/index/build/artifacts/token-mode.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const baseState = {
  chunks: [{ tokens: ['a', 'b', 'c'] }]
};

const autoSample = resolveTokenMode({
  indexingConfig: {},
  state: baseState,
  fileCounts: { candidates: 6000 }
});
if (autoSample.resolvedTokenMode !== 'sample') {
  fail('Expected auto mode to resolve to sample when file count exceeds max.');
}

const tokenBudgetSample = resolveTokenMode({
  indexingConfig: { chunkTokenMaxTokens: 1 },
  state: { chunks: [{ tokens: ['a', 'b'] }] },
  fileCounts: { candidates: 1 }
});
if (tokenBudgetSample.resolvedTokenMode !== 'sample') {
  fail('Expected auto mode to resolve to sample when token budget exceeded.');
}

const noneMode = resolveTokenMode({
  indexingConfig: { chunkTokenMode: 'none' },
  state: baseState,
  fileCounts: { candidates: 0 }
});
if (noneMode.resolvedTokenMode !== 'none') {
  fail('Expected explicit chunkTokenMode=none to be respected.');
}

console.log('artifact token mode tests passed');
