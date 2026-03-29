#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  applyByteBudget,
  DEFAULT_BYTE_BUDGETS,
  resolveByteBudget,
  resolveByteBudgetMap
} from '../../../src/index/build/byte-budget.js';
import { resolveFileCapsAndGuardrails } from '../../../src/index/build/runtime/caps.js';
import { LANGUAGE_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';
import { buildContentConfigHash, normalizeContentConfig } from '../../../src/index/build/runtime/hash.js';
import { buildStageOverrides, normalizeStage } from '../../../src/index/build/runtime/stage.js';
import { createStageCheckpointRecorder } from '../../../src/index/build/stage-checkpoints.js';
import { createIndexState } from '../../../src/index/build/state.js';
import { createTokenRetentionState } from '../../../src/index/build/indexer/steps/postings.js';

{
  assert.equal(normalizeStage('stage1'), 'stage1');
  assert.equal(normalizeStage('embed'), 'stage3');
  assert.equal(normalizeStage('ann'), 'stage4');
  assert.equal(normalizeStage(''), null);

  const stage1Overrides = buildStageOverrides({ stage1: { lint: true } }, 'stage1');
  assert.equal(stage1Overrides?.lint, true);
  assert.equal(stage1Overrides?.embeddings?.enabled, false);
  assert.equal(stage1Overrides?.treeSitter?.enabled, false);
  assert.equal(stage1Overrides?.typeInference, false);

  const stage2Overrides = buildStageOverrides({ stage2: { lint: false, embeddings: { enabled: true } } }, 'stage2');
  assert.equal(stage2Overrides?.embeddings?.enabled, true);

  const stage3Overrides = buildStageOverrides({ stage3: { lint: true } }, 'stage3');
  assert.equal(stage3Overrides?.lint, true);
  assert.equal(stage3Overrides?.treeSitter?.enabled, false);
  assert.equal(buildStageOverrides({}, 'unknown'), null);
}

{
  const MB = 1024 * 1024;
  const { maxFileBytes, fileCaps, guardrails } = resolveFileCapsAndGuardrails({
    maxFileBytes: 8 * MB,
    fileCaps: {
      default: { maxBytes: 6 * MB, maxLines: 5000 },
      byExt: { '.js': { maxBytes: 2 * MB } },
      byLanguage: { javascript: { maxLines: 1000 } },
      byMode: { prose: { maxBytes: 4 * MB } }
    },
    untrusted: {
      enabled: true,
      maxFileBytes: 1 * MB,
      maxLines: 200
    }
  });
  assert.equal(guardrails.enabled, true);
  assert.equal(maxFileBytes, 1 * MB);
  assert.equal(fileCaps.default.maxBytes, 1 * MB);
  assert.equal(fileCaps.default.maxLines, 200);
  assert.equal(fileCaps.byExt['.js'].maxBytes, 1 * MB);
  assert.equal(fileCaps.byLanguage.javascript.maxBytes, LANGUAGE_CAPS_BASELINES.javascript.maxBytes);
  assert.equal(fileCaps.byLanguage.javascript.maxLines, 200);
  assert.equal(fileCaps.byMode.prose.maxBytes, 1 * MB);
}

{
  const config = {
    indexing: {
      concurrency: 12,
      importConcurrency: 4,
      workerPool: { enabled: true },
      debugCrash: true,
      shards: { enabled: true },
      fileListSampleSize: 123,
      maxFileBytes: 2048
    }
  };
  const normalized = normalizeContentConfig(config);
  assert.equal(normalized.indexing?.maxFileBytes, 2048);
  for (const key of ['concurrency', 'importConcurrency', 'workerPool', 'debugCrash', 'shards', 'fileListSampleSize']) {
    assert.equal(normalized.indexing?.[key], undefined);
  }
  const envA = { cacheRoot: '/tmp/a', stage: 'stage1' };
  const envB = { cacheRoot: '/tmp/b', stage: 'stage1' };
  const hashA = buildContentConfigHash(config, envA);
  const hashB = buildContentConfigHash(config, envB);
  assert.equal(hashA, hashB, 'expected cacheRoot differences to be ignored');
  const hashC = buildContentConfigHash({ indexing: { concurrency: 1, importConcurrency: 2, maxFileBytes: 2048 } }, envA);
  assert.equal(hashA, hashC, 'expected concurrency-only changes to be ignored');
  const hashD = buildContentConfigHash(config, { cacheRoot: '/tmp/a', stage: 'stage2' });
  assert.notEqual(hashA, hashD, 'expected stage changes to affect content hash');
  const hashE = buildContentConfigHash({ indexing: { maxFileBytes: 4096 } }, envA);
  assert.notEqual(hashA, hashE, 'expected relevant config changes to affect content hash');
}

{
  const resolved = resolveByteBudgetMap({
    indexingConfig: {},
    maxJsonBytes: 1024
  });
  for (const [artifact, policy] of Object.entries(DEFAULT_BYTE_BUDGETS)) {
    const resolvedPolicy = resolved.policies[artifact];
    assert.ok(resolvedPolicy, `missing resolved policy for ${artifact}`);
    assert.equal(resolvedPolicy.maxBytes, 1024);
    assert.equal(resolvedPolicy.overflow, policy.overflow);
    assert.equal(resolvedPolicy.strict, false);
  }

  const override = resolveByteBudget({
    artifact: 'token_postings',
    maxJsonBytes: 2048,
    overrides: {
      token_postings: { maxBytes: 512, overflow: 'warn', strict: true }
    },
    strict: false
  });
  assert.equal(override.maxBytes, 512);
  assert.equal(override.overflow, 'warn');
  assert.equal(override.strict, true);

  const warnings = [];
  const info = applyByteBudget({
    budget: { artifact: 'repo_map', maxBytes: 100, overflow: 'warn', strict: false },
    totalBytes: 140,
    label: 'repo_map',
    logger: (line) => warnings.push(line)
  });
  assert.equal(info.overBytes, 40);
  assert.equal(warnings.length, 1);

  await assert.rejects(
    async () => applyByteBudget({
      budget: { artifact: 'vfs_manifest', maxBytes: 100, overflow: 'fail', strict: false },
      totalBytes: 140,
      label: 'vfs_manifest'
    }),
    (err) => err?.code === 'ERR_BYTE_BUDGET'
  );

  const enforced = resolveByteBudgetMap({
    indexingConfig: {
      artifacts: {
        byteBudgetPolicy: {
          artifacts: {
            chunk_meta: { maxBytes: 100, overflow: 'fail', strict: true },
            symbol_edges: { maxBytes: 200, overflow: 'warn' }
          }
        }
      }
    },
    maxJsonBytes: 1000
  }).policies;
  await assert.rejects(
    async () => applyByteBudget({
      budget: enforced.chunk_meta,
      totalBytes: 250,
      label: 'chunk_meta',
      logger: () => {}
    }),
    (err) => err?.code === 'ERR_BYTE_BUDGET'
  );
  let warned = false;
  applyByteBudget({
    budget: enforced.symbol_edges,
    totalBytes: 250,
    label: 'symbol_edges',
    logger: () => { warned = true; }
  });
  assert.equal(warned, true);

  const specPath = path.join(process.cwd(), 'docs', 'specs', 'byte-budget-policy.md');
  const specText = await fs.readFile(specPath, 'utf8');
  const docBudgetLines = specText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^- [a-z_]+: maxJsonBytes, overflow=[a-z]+$/i.test(line));
  const docMap = new Map();
  for (const line of docBudgetLines) {
    const match = line.match(/^- ([a-z_]+): maxJsonBytes, overflow=([a-z]+)$/i);
    if (!match) continue;
    docMap.set(match[1], match[2].toLowerCase());
  }
  for (const [artifact, policy] of Object.entries(DEFAULT_BYTE_BUDGETS)) {
    assert.equal(docMap.get(artifact), policy.overflow, `docs budget table overflow mismatch for ${artifact}`);
  }
}

{
  const recorder = createStageCheckpointRecorder({ mode: 'code' });
  recorder.record({ stage: 'stage1', step: 'discovery', extra: { files: 10 } });
  recorder.record({
    stage: 'stage2',
    step: 'write',
    extra: {
      vfsManifest: {
        rows: 10,
        bytes: 1024,
        maxLineBytes: 256,
        trimmedRows: 2,
        droppedRows: 1,
        runsSpilled: 0
      }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  recorder.record({ stage: 'stage1', step: 'postings', extra: { chunks: 5 } });
  recorder.record({
    stage: 'stage2',
    step: 'write',
    extra: {
      vfsManifest: {
        rows: 15,
        bytes: 900,
        maxLineBytes: 512,
        trimmedRows: 4,
        droppedRows: 3,
        runsSpilled: 1
      }
    }
  });

  const summary = recorder.buildSummary();
  assert.equal(summary.mode, 'code');
  assert.equal(summary.checkpoints.length, 4);
  const memory = summary.checkpoints[0].memory || {};
  for (const field of ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers']) {
    const value = memory[field];
    if (value !== null) assert.equal(Number.isFinite(value), true, `memory.${field} should be finite`);
  }
  const stage1Summary = summary.stages.stage1;
  assert.ok(stage1Summary);
  assert.equal(stage1Summary.checkpointCount, 2);
  assert.ok(stage1Summary.elapsedMs >= 0);
  const elapsedValues = summary.checkpoints.map((entry) => entry.elapsedMs);
  assert.ok(elapsedValues[1] >= elapsedValues[0]);
  const highWaterChunks = summary.highWater?.extra?.chunks;
  assert.equal(highWaterChunks, 5);
  const vfsHighWater = summary.stages.stage2?.extraHighWater?.vfsManifest;
  assert.ok(vfsHighWater);
  assert.equal(vfsHighWater.rows, 15);
  assert.equal(vfsHighWater.bytes, 1024);
  assert.equal(vfsHighWater.maxLineBytes, 512);
  assert.equal(vfsHighWater.trimmedRows, 4);
  assert.equal(vfsHighWater.droppedRows, 3);
  assert.equal(vfsHighWater.runsSpilled, 1);
}

{
  const runtime = {
    userConfig: {
      indexing: {
        chunkTokenMode: 'auto',
        chunkTokenMaxTokens: 5,
        chunkTokenSampleSize: 2
      }
    },
    postingsConfig: {},
    embeddingEnabled: false
  };
  const state = createIndexState();
  const { appendChunkWithRetention } = createTokenRetentionState({
    runtime,
    totalFiles: 1,
    log: () => {}
  });
  appendChunkWithRetention(state, {
    file: 'alpha.js',
    tokens: ['a', 'b', 'c'],
    seq: ['a', 'b', 'c'],
    docmeta: {},
    stats: {},
    minhashSig: [1, 2]
  }, state);
  appendChunkWithRetention(state, {
    file: 'beta.js',
    tokens: ['d', 'e', 'f', 'g'],
    seq: ['d', 'e', 'f', 'g'],
    docmeta: {},
    stats: {},
    minhashSig: [3, 4]
  }, state);
  const tokensA = state.chunks[0]?.tokens || [];
  const tokensB = state.chunks[1]?.tokens || [];
  assert.ok(tokensA.length <= 2 && tokensB.length <= 2, 'expected tokens to be sampled after threshold');
}

console.log('indexing runtime contract matrix test passed');
