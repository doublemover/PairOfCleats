#!/usr/bin/env node
import { classifyQuery, resolveIntentFieldWeights, resolveIntentVectorMode } from '../../../src/retrieval/query-intent.js';

const cases = [
  { query: 'src/utils/file.ts', tokens: ['src/utils/file.ts'], phrases: [], expect: 'path' },
  { query: 'renderToString', tokens: ['renderToString'], phrases: [], expect: 'code' },
  { query: 'how to configure proxy headers', tokens: ['how', 'to', 'configure', 'proxy', 'headers'], phrases: [], expect: 'prose' },
  { query: 'parse json', tokens: ['parse', 'json'], phrases: ['parse json'], expect: 'mixed' }
];

for (const sample of cases) {
  const info = classifyQuery({
    query: sample.query,
    tokens: sample.tokens,
    phrases: sample.phrases
  });
  if (info.type !== sample.expect) {
    console.error(`Expected intent ${sample.expect} for "${sample.query}", got ${info.type}`);
    process.exit(1);
  }
}

const proseIntent = classifyQuery({
  query: 'how to configure proxy headers',
  tokens: ['how', 'to', 'configure', 'proxy', 'headers'],
  phrases: []
});
const weights = resolveIntentFieldWeights(null, proseIntent);
if (!weights || !(weights.doc > weights.name)) {
  console.error('Expected prose intent to emphasize doc weights.');
  process.exit(1);
}

const vectorMode = resolveIntentVectorMode('auto', proseIntent);
if (vectorMode !== 'doc') {
  console.error(`Expected auto vector mode to resolve to doc for prose, got ${vectorMode}`);
  process.exit(1);
}

console.log('query intent test passed');
