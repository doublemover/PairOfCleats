#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import {
  captureSearchOutputStdout,
  createSearchOutputHitState,
  createSearchOutputOptions
} from '../helpers/search-output-fixture.js';

applyTestEnv();

const proseHit = {
  file: 'docs/guides/search.md',
  start: 0,
  end: 1,
  startLine: 10,
  endLine: 18,
  name: 'Search Pipeline',
  kind: 'Section',
  score: 1
};

const output = await withTemporaryEnv({ COLUMNS: '88' }, async () => await captureSearchOutputStdout(async () => {
  renderSearchOutput(createSearchOutputOptions({
    emitOutput: true,
    jsonOutput: false,
    jsonCompact: false,
    explain: false,
    color,
    backendLabel: 'sqlite-fts',
    backendPolicyInfo: null,
    routingPolicy: null,
    runCode: false,
    runProse: true,
    topN: 1,
    rawQuery: '"Search Pipeline"',
    queryTokens: ['search', 'pipeline'],
    highlightRegex: /Search Pipeline/giu,
    ...createSearchOutputHitState({ proseHits: [proseHit] }),
    annBackend: 'js',
    vectorExtension: { annMode: 'dense', provider: null, table: null },
    modelIds: { code: null, prose: null, extractedProse: null, records: null },
    embeddingProvider: null,
    embeddingOnnx: { modelPath: null, tokenizerId: null },
    intentInfo: null,
    resolvedDenseVectorMode: 'merged',
    contextExpansionStats: { enabled: false },
    elapsedMs: 11
  }));
}));

assert.match(stripAnsi(output), /^query "Search Pipeline"$/m, 'expected header to preserve the raw query text');

console.log('raw query header test passed');
