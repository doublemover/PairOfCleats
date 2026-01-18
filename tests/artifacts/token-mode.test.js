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

const invalidMode = resolveTokenMode({
  indexingConfig: { chunkTokenMode: 'NOPE' },
  state: baseState,
  fileCounts: { candidates: 1 }
});
if (invalidMode.tokenMode !== 'auto') {
  fail('Expected invalid chunkTokenMode to fall back to auto.');
}

const caseInsensitive = resolveTokenMode({
  indexingConfig: { chunkTokenMode: 'SAMPLE' },
  state: baseState,
  fileCounts: { candidates: 0 }
});
if (caseInsensitive.resolvedTokenMode !== 'sample') {
  fail('Expected chunkTokenMode parsing to be case-insensitive.');
}

const parsedLimits = resolveTokenMode({
  indexingConfig: { chunkTokenMaxFiles: '12', chunkTokenMaxTokens: '7.9' },
  state: { chunks: [{ tokens: ['a'] }] },
  fileCounts: { candidates: 100 }
});
if (parsedLimits.tokenMaxFiles !== 12 || parsedLimits.tokenMaxTotal !== 7) {
  fail('Expected chunkTokenMaxFiles/maxTokens to parse numeric strings.');
}

console.log('artifact token mode tests passed');
