#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  captureSearchOutputStreams,
  createSearchOutputHitState,
  createSearchOutputOptions
} from '../helpers/search-output-fixture.js';

applyTestEnv();

const codeHit = {
  id: 1,
  file: 'src/a.js',
  start: 0,
  end: 1,
  score: 1,
  scoreType: 'bm25'
};

const sharedInput = createSearchOutputOptions({
  emitOutput: true,
  jsonOutput: true,
  jsonCompact: false,
  explain: false,
  color,
  backendPolicyInfo: null,
  routingPolicy: null,
  topN: 1,
  highlightRegex: /alpha/g,
  ...createSearchOutputHitState({ codeHits: [codeHit] }),
  annBackend: 'js',
  vectorExtension: { annMode: 'dense', provider: null, table: null },
  modelIds: { code: null, prose: null, extractedProse: null, records: null },
  embeddingProvider: null,
  embeddingOnnx: { modelPath: null, tokenizerId: null },
  profileInfo: {
    warnings: [
      'Sparse-only request overridden for vector_only mode(s): code. ANN fallback was used.',
      '[ops-resource] code=op_resource_retrieval_memory_growth_abnormal component=retrieval metric=rss baselineMiB=64.0 currentMiB=160.0 deltaMiB=96.0 ratio=2.50 next="Inspect retrieval memory growth."'
    ]
  },
  intentInfo: null,
  resolvedDenseVectorMode: 'merged',
  contextExpansionStats: { enabled: false },
  idxProse: null,
  idxExtractedProse: null,
  idxRecords: null,
  showStats: true,
  elapsedMs: 5
});

for (const streamJson of [false, true]) {
  const captured = await captureSearchOutputStreams(async () => {
    renderSearchOutput({
      ...sharedInput,
      streamJson
    });
  });
  assert.equal(captured.stderr.trim(), '', `expected stderr to stay empty for jsonOutput streamJson=${streamJson}`);
  assert.doesNotMatch(captured.stdout, /\[ops-resource\]/u, 'expected raw diagnostics to stay out of JSON stdout');
  const parsed = JSON.parse(captured.stdout);
  assert.equal(parsed.backend, 'memory');
  assert.equal(parsed.code.length, 1);
  assert.equal(Array.isArray(parsed.stats?.profile?.warnings), true, 'expected structured warnings to remain in JSON payload');
}

console.log('json diagnostics routing test passed');
