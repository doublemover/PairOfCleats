#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  captureSearchOutputStdout,
  createSearchOutputHitState,
  createSearchOutputOptions
} from '../helpers/search-output-fixture.js';

applyTestEnv();

const hits = [
  { id: 1, file: 'src/a.js', start: 0, end: 1, score: 1, scoreType: 'bm25' }
];

const output = await captureSearchOutputStdout(async () => {
  renderSearchOutput(createSearchOutputOptions({
    emitOutput: true,
    explain: false,
    color,
    backendPolicyInfo: null,
    routingPolicy: null,
    topN: 1,
    highlightRegex: /alpha/g,
    ...createSearchOutputHitState({ codeHits: hits }),
    annBackend: 'js',
    vectorExtension: { annMode: 'dense', provider: null, table: null },
    modelIds: { code: null, prose: null, extractedProse: null, records: null },
    embeddingProvider: null,
    embeddingOnnx: { modelPath: null, tokenizerId: null },
    intentInfo: null,
    resolvedDenseVectorMode: 'merged',
    contextExpansionStats: { enabled: false },
    idxProse: null,
    idxExtractedProse: null,
    idxCode: null,
    idxRecords: null,
    elapsedMs: 1,
    streamJson: true
  }));
});

const parsed = JSON.parse(output);
assert.equal(parsed.backend, 'memory');
assert.equal(parsed.retrieval?.backend?.selected, 'memory');
assert.equal(parsed.retrieval?.cache?.hit, false);
assert.equal(parsed.code.length, 1);
assert.equal(parsed.code[0].file, 'src/a.js');

console.log('json streaming output test passed');
