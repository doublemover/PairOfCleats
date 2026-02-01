#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCodeRelations } from '../../../src/lang/javascript/relations.js';
import { extractDocMeta } from '../../../src/lang/javascript/docmeta.js';
import { applyCrossFileInference } from '../../../src/index/type-inference-crossfile/pipeline.js';

const text = `function f({a,b}, x=1, ...rest) {}
 f({a:1,b:2}, 2, 3);
`;
const relPath = 'src/sample.js';
const relations = buildCodeRelations(text, relPath, { dataflow: false, controlFlow: false });

const fnStart = text.indexOf('function f');
const fnEnd = text.indexOf('}', fnStart);
const fnChunk = { start: fnStart, end: fnEnd + 1, name: 'f' };
const docmeta = extractDocMeta(text, fnChunk, relations);

assert.deepEqual(
  docmeta.paramNames,
  ['arg0', 'x', 'rest'],
  'docmeta.paramNames should use stable placeholders for patterns'
);

const functionChunk = {
  name: 'f',
  file: relPath,
  kind: 'Function',
  chunkUid: 'uid-f',
  docmeta,
  metaV2: {
    symbol: {
      symbolId: 'sym-f',
      chunkUid: 'uid-f',
      symbolKey: 'sym:f',
      signatureKey: 'sig:f',
      kindGroup: 'function',
      qualifiedName: 'f'
    }
  }
};

const moduleChunk = {
  name: '(module)',
  file: relPath,
  kind: 'Module',
  chunkUid: 'uid-module',
  docmeta: {},
  codeRelations: relations
};

await applyCrossFileInference({
  rootDir: process.cwd(),
  buildRoot: process.cwd(),
  chunks: [moduleChunk, functionChunk],
  enabled: true,
  log: () => {},
  useTooling: false,
  enableTypeInference: false,
  enableRiskCorrelation: false,
  fileRelations: null
});

const summaries = moduleChunk.codeRelations?.callSummaries || [];
const summary = summaries.find((entry) => entry?.name === 'f');
assert.ok(summary, 'call summary for f missing');
assert.deepEqual(
  summary.params,
  ['arg0', 'x', 'rest'],
  'call summary param names should use stable placeholders'
);

console.log('javascript param names test passed');
