#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import {
  captureSearchOutputStreams,
  createSearchOutputHitState,
  createSearchOutputOptions
} from '../helpers/search-output-fixture.js';

applyTestEnv();

const codeHits = [
  {
    file: 'src/retrieval/cli/render.js',
    name: 'renderSearchOutput',
    kind: 'Function',
    start: 0,
    end: 1,
    startLine: 20,
    endLine: 60,
    score: 0.92,
    scoreType: 'rrf',
    docmeta: {
      signature: 'renderSearchOutput(options)',
      returnsValue: true
    }
  }
];

const proseHits = [
  {
    file: 'docs/guides/search.md',
    name: 'Search Pipeline',
    kind: 'Section',
    start: 0,
    end: 1,
    startLine: 12,
    endLine: 20,
    score: 0.81,
    scoreType: 'bm25',
    headline: 'Search Pipeline covers indexing, ranking, and result rendering.'
  }
];

const captured = await withTemporaryEnv({ COLUMNS: '72' }, async () => await captureSearchOutputStreams(async () => {
  renderSearchOutput(createSearchOutputOptions({
    emitOutput: true,
    jsonOutput: false,
    jsonCompact: false,
    explain: false,
    color,
    backendLabel: 'sqlite',
    backendPolicyInfo: null,
    routingPolicy: null,
    runCode: true,
    runProse: true,
    runExtractedProse: true,
    runRecords: true,
    topN: 3,
    queryTokens: ['renderSearchOutput'],
    highlightRegex: /renderSearchOutput/g,
    ...createSearchOutputHitState({ proseHits, codeHits }),
    annBackend: 'js',
    vectorExtension: { annMode: 'dense', provider: null, table: null },
    modelIds: { code: null, prose: null, extractedProse: null, records: null },
    embeddingProvider: null,
    embeddingOnnx: { modelPath: null, tokenizerId: null },
    intentInfo: null,
    resolvedDenseVectorMode: 'merged',
    contextExpansionStats: { enabled: false },
    elapsedMs: 17
  }));
}));

const cleanStdout = stripAnsi(captured.stdout);

assert.match(cleanStdout, /Search Results/);
assert.match(cleanStdout, /^Search Results\s+elapsed 17ms$/m);
assert.match(cleanStdout, /^query renderSearchOutput$/m);
assert.match(cleanStdout, /Code Results \(1\)/);
assert.match(cleanStdout, /^Code Results \(1\) ─/m);
assert.match(cleanStdout, /Text Results \(1\)/);
assert.doesNotMatch(cleanStdout, /Code Comments Results/);
assert.match(cleanStdout, /backend sqlite/);
assert.match(cleanStdout, /hits 1 code/);
assert.doesNotMatch(cleanStdout, /modes .*records/u, 'expected header modes to omit suppressed empty sections');
assert.equal(captured.stderr.trim(), '', 'expected diagnostics stderr to remain empty for normal human output');

console.log('human render layout test passed');
