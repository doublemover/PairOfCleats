#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createProcessChunksFixtureContext,
  processFixtureChunks
} from './process-chunks-fixture.js';

const { context: baseContext } = createProcessChunksFixtureContext({
  rel: 'src/fallback.js',
  segmentUid: 'seg-fallback',
  relationsEnabled: true,
  lang: {
    id: 'javascript',
    extractDocMeta: () => ({ paramTypes: { token: 'string' } }),
    buildRelations: () => ({ imports: ['./dep.js'], calls: [['example', 'dep']] })
  }
});

const astFull = await processFixtureChunks(baseContext, {
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: false,
    fallbackSegmentCount: 0,
    schedulerMissingCount: 0
  }
});
assert.equal(astFull.chunks[0].metaV2?.parser?.mode, 'ast-full');
assert.ok(astFull.chunks[0].docmeta?.risk, 'ast-full should retain risk metadata');
assert.ok(astFull.chunks[0].docmeta?.inferredTypes, 'ast-full should retain type inference metadata');

const astFullWithNonCodeFallback = await processFixtureChunks(baseContext, {
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: true,
    usedHeuristicCodeChunking: false,
    fallbackSegmentCount: 2,
    codeFallbackSegmentCount: 0,
    schedulerMissingCount: 0
  }
});
assert.equal(
  astFullWithNonCodeFallback.chunks[0].metaV2?.parser?.mode,
  'ast-full',
  'non-code fallback segments should not force syntax-lite parser mode'
);

const syntaxLite = await processFixtureChunks(baseContext, {
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: true,
    fallbackSegmentCount: 1,
    schedulerMissingCount: 1
  }
});
assert.equal(syntaxLite.chunks[0].metaV2?.parser?.mode, 'syntax-lite');
assert.equal(syntaxLite.chunks[0].metaV2?.parser?.reasonCode, 'USR-R-PARSER-UNAVAILABLE');
assert.equal(syntaxLite.chunks[0].docmeta?.risk, undefined, 'syntax-lite should disable risk metadata');
assert.equal(syntaxLite.chunks[0].docmeta?.inferredTypes, undefined, 'syntax-lite should disable type inference metadata');

const syntaxLiteRepeat = await processFixtureChunks(baseContext, {
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: true,
    fallbackSegmentCount: 1,
    schedulerMissingCount: 1
  }
});
assert.deepEqual(
  syntaxLiteRepeat.chunks[0].metaV2?.parser,
  syntaxLite.chunks[0].metaV2?.parser,
  'syntax-lite parser metadata should be deterministic across runs'
);

const syntaxLiteHeavyDownshift = await processFixtureChunks(baseContext, {
  languageOptions: {
    heavyFile: {
      enabled: true,
      maxBytes: 1,
      maxLines: 10_000,
      maxChunks: 10_000,
      skipTokenization: true,
      skipTokenizationMaxBytes: 10_000_000,
      skipTokenizationMaxLines: 10_000_000,
      skipTokenizationMaxChunks: 10_000_000
    }
  },
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: false,
    fallbackSegmentCount: 0,
    schedulerMissingCount: 0
  }
});
assert.equal(syntaxLiteHeavyDownshift.chunks[0].metaV2?.parser?.mode, 'syntax-lite');
assert.equal(
  syntaxLiteHeavyDownshift.chunks[0].metaV2?.parser?.reasonCode,
  'USR-R-RESOURCE-BUDGET-EXCEEDED'
);
assert.equal(
  syntaxLiteHeavyDownshift.chunks[0].docmeta?.risk,
  undefined,
  'heavy-file syntax-lite should disable risk metadata'
);
assert.equal(
  syntaxLiteHeavyDownshift.chunks[0].docmeta?.inferredTypes,
  undefined,
  'heavy-file syntax-lite should disable type inference metadata'
);

const chunkOnly = await processFixtureChunks(baseContext, {
  languageOptions: {
    heavyFile: {
      enabled: true,
      maxBytes: 1,
      maxLines: 1,
      maxChunks: 1,
      skipTokenization: true,
      skipTokenizationMaxBytes: 1,
      skipTokenizationMaxLines: 1,
      skipTokenizationMaxChunks: 1
    }
  },
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: false,
    fallbackSegmentCount: 0,
    schedulerMissingCount: 0
  }
});
assert.equal(chunkOnly.chunks[0].metaV2?.parser?.mode, 'chunk-only');
assert.equal(chunkOnly.chunks[0].metaV2?.parser?.reasonCode, 'USR-R-RESOURCE-BUDGET-EXCEEDED');
assert.equal(chunkOnly.chunks[0].metaV2?.relations?.calls || null, null, 'chunk-only should not emit call relations');

console.log('fallback mode contract test passed');
