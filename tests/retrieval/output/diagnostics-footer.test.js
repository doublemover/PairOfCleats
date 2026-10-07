#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import {
  captureSearchOutputStreams,
  createSearchOutputOptions
} from '../helpers/search-output-fixture.js';

applyTestEnv();

const captured = await withTemporaryEnv({ COLUMNS: '104' }, async () => await captureSearchOutputStreams(async () => {
  renderSearchOutput(createSearchOutputOptions({
    emitOutput: true,
    jsonOutput: false,
    jsonCompact: false,
    explain: false,
    color,
    backendLabel: 'sqlite',
    backendPolicyInfo: null,
    routingPolicy: null,
    topN: 3,
    highlightRegex: /alpha/g,
    annBackend: 'js',
    vectorExtension: { annMode: 'dense', provider: null, table: null },
    modelIds: { code: null, prose: null, extractedProse: null, records: null },
    embeddingProvider: null,
    embeddingOnnx: { modelPath: null, tokenizerId: null },
    profileInfo: {
      warnings: [
        'Sparse-only request overridden for vector_only mode(s): code. ANN fallback was used.',
        '[ops-resource] code=op_resource_retrieval_memory_growth_abnormal component=retrieval metric=rss baselineMiB=64.0 currentMiB=160.0 deltaMiB=96.0 ratio=2.50 next=\"Inspect retrieval memory growth.\"'
      ]
    },
    intentInfo: null,
    resolvedDenseVectorMode: 'merged',
    contextExpansionStats: { enabled: false },
    elapsedMs: 12
  }));
}));

const cleanStdout = stripAnsi(captured.stdout);
assert.match(cleanStdout, /Diagnostics \(2\) ─/);
assert.match(cleanStdout, /! Sparse-only request overridden/);
assert.match(cleanStdout, /! Resource: component retrieval • metric rss • growth 2.50x • delta \+96.0 MiB/);
assert.match(cleanStdout, /64.0 MiB -> 160.0 MiB/);
assert.match(cleanStdout, /next Inspect retrieval memory growth\./);
assert.doesNotMatch(cleanStdout, /\[ops-resource\]/);
assert.equal(captured.stderr.trim(), '', 'expected diagnostics footer to stay on stdout in human mode');

console.log('diagnostics footer test passed');
