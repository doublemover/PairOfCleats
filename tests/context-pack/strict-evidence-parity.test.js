#!/usr/bin/env node
import assert from 'node:assert/strict';

import { runContextPackCli } from '../../src/integrations/tooling/context-pack.js';
import { loadChunkMeta, MAX_JSON_BYTES } from '../../src/shared/artifact-io.js';
import {
  createAnalysisSurfaceHarness,
  normalizeSurfaceError
} from '../helpers/analysis-surface-parity.js';
import { ensureFixtureIndex } from '../helpers/fixture-index.js';
import { applyTestEnv, withTemporaryEnv } from '../helpers/test-env.js';

applyTestEnv();

const runCliSilently = async (args) => {
  const originalLog = console.log;
  try {
    console.log = () => {};
    return await runContextPackCli(args);
  } finally {
    console.log = originalLog;
  }
};

const { fixtureRoot, codeDir, env } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'context-pack-strict-evidence-parity',
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const chunkMeta = await loadChunkMeta(codeDir, {
  maxBytes: MAX_JSON_BYTES,
  strict: true
});
const chunk = Array.isArray(chunkMeta)
  ? chunkMeta.find((entry) => typeof entry?.chunkUid === 'string' && entry.chunkUid && typeof entry?.file === 'string' && entry.file)
  : null;
assert.ok(chunk?.chunkUid, 'expected fixture chunk for context-pack strict evidence parity');

await withTemporaryEnv(env, async () => {
  const harness = await createAnalysisSurfaceHarness({ fixtureRoot, env: process.env });
  try {
    const args = {
      repoPath: fixtureRoot,
      seed: `chunk:${chunk.chunkUid}`,
      hops: 0,
      includeGraph: false,
      includeImports: false,
      includeUsages: false,
      includeCallersCallees: false,
      strictEvidence: true,
      maxTokens: 1
    };

    const cliRun = await runCliSilently([
      '--json',
      '--repo', fixtureRoot,
      '--seed', args.seed,
      '--hops', '0',
      '--includeGraph=false',
      '--includeImports=false',
      '--includeUsages=false',
      '--includeCallersCallees=false',
      '--strictEvidence',
      '--maxTokens', '1'
    ]);
    assert.equal(cliRun?.ok, false, 'expected strict evidence CLI request to fail');
    assert.deepEqual(normalizeSurfaceError(cliRun), {
      code: 'INVALID_REQUEST',
      reason: 'strict_evidence_incomplete'
    });
    assert.equal(cliRun?.evidence?.complete, false, 'expected CLI strict evidence failure to expose evidence details');

    const apiResponse = await harness.runApi('/analysis/context-pack', args);
    assert.equal(apiResponse.status, 400, 'expected strict evidence API request to fail');
    assert.deepEqual(normalizeSurfaceError(apiResponse.parsed), {
      code: 'INVALID_REQUEST',
      reason: 'strict_evidence_incomplete'
    });
    assert.equal(apiResponse.parsed?.evidence?.complete, false, 'expected API error details to expose evidence');

    const mcpResponse = await harness.runMcp('context_pack', args);
    assert.equal(mcpResponse.ok, false, 'expected strict evidence MCP request to fail');
    assert.deepEqual(normalizeSurfaceError(mcpResponse.error), {
      code: 'INVALID_REQUEST',
      reason: 'strict_evidence_incomplete'
    });
    assert.equal(mcpResponse.error?.evidence?.complete, false, 'expected MCP error details to expose evidence');
  } finally {
    await harness.close();
  }
});

console.log('context pack strict evidence parity test passed');
