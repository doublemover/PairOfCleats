#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { normalizePostingsConfig } from '../../src/shared/postings-config.js';
import { quantizeVec } from '../../src/index/embedding.js';
import { createTokenizationContext, tokenizeChunkText } from '../../src/index/build/tokenization.js';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../src/index/build/worker-pool.js';
import { applyCrossFileInference } from '../../src/index/type-inference-crossfile.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { cleanup, root } from './smoke-utils.js';

const cacheRoots = [resolveTestCachePath(root, 'type-inference-crossfile-stats')];

const runWorkerPoolSmoke = async () => {
  const postingsConfig = normalizePostingsConfig({
    enablePhraseNgrams: true,
    phraseMinN: 2,
    phraseMaxN: 3,
    enableChargrams: true,
    chargramMinN: 3,
    chargramMaxN: 3
  });
  const dictWords = new Set(['hello', 'world', 'foo', 'bar']);
  const dictConfig = { segmentation: 'greedy' };
  const workerConfig = normalizeWorkerPoolConfig({
    enabled: true,
    maxWorkers: 1,
    maxFileBytes: 4096,
    quantizeBatchSize: 2,
    taskTimeoutMs: 5000
  }, { cpuLimit: 1 });

  const workerPool = await createIndexerWorkerPool({
    config: workerConfig,
    dictWords,
    dictConfig,
    postingsConfig
  });
  if (!workerPool) {
    return;
  }

  try {
    const context = createTokenizationContext({ dictWords, dictConfig, postingsConfig });
    const sample = 'helloWorld fooBar';
    const syncTokens = tokenizeChunkText({ text: sample, mode: 'code', ext: '.js', context });
    const workerTokens = await workerPool.tokenizeChunk({ text: sample, mode: 'code', ext: '.js' });
    assert.deepEqual(workerTokens.tokens, syncTokens.tokens);

    const vectors = [
      [0, 0.5],
      [1, -1]
    ];
    const syncQuant = vectors.map((vec) => quantizeVec(vec));
    const workerQuant = await workerPool.runQuantize({ vectors });
    assert.deepEqual(workerQuant, syncQuant);
  } finally {
    await workerPool.destroy();
  }
};

const buildSymbolMeta = ({ file, name, kind, chunkUid }) => ({
  chunkUid,
  file,
  name,
  kind,
  symbol: {
    v: 1,
    scheme: 'heur',
    kindGroup: String(kind || '').toLowerCase().includes('class') ? 'class' : 'function',
    qualifiedName: name,
    symbolKey: `${file}::${name}`,
    signatureKey: null,
    scopedId: `${kind}|${file}::${name}|${chunkUid}`,
    symbolId: `sym1:heur:${chunkUid}`
  }
});

const writeScenarioFile = async (rootDir, relPath, contents) => {
  const absPath = path.join(rootDir, relPath);
  await fsPromises.mkdir(path.dirname(absPath), { recursive: true });
  await fsPromises.writeFile(absPath, contents, 'utf8');
};

const runCrossfileSmoke = async () => {
  const scenarioRoot = path.join(resolveTestCachePath(root, 'type-inference-crossfile-stats'), 'smoke-scenario');
  await fsPromises.rm(scenarioRoot, { recursive: true, force: true });
  await fsPromises.mkdir(scenarioRoot, { recursive: true });

  const producer = 'export function helper() { return 7; }\n';
  const consumer = 'export function useHelper() { return helper(); }\n';
  await writeScenarioFile(scenarioRoot, 'src/helper.js', producer);
  await writeScenarioFile(scenarioRoot, 'src/consumer.js', consumer);

  const stats = await applyCrossFileInference({
    rootDir: scenarioRoot,
    enabled: true,
    log: () => {},
    useTooling: false,
    enableTypeInference: true,
    enableRiskCorrelation: true,
    chunks: [
      {
        file: 'src/consumer.js',
        name: 'useHelper',
        kind: 'function',
        chunkUid: 'uid-consumer',
        start: 0,
        end: consumer.length,
        docmeta: { returnsValue: true },
        codeRelations: {
          calls: [['useHelper', 'helper']]
        },
        metaV2: buildSymbolMeta({
          file: 'src/consumer.js',
          name: 'useHelper',
          kind: 'function',
          chunkUid: 'uid-consumer'
        })
      },
      {
        file: 'src/helper.js',
        name: 'helper',
        kind: 'function',
        chunkUid: 'uid-helper',
        start: 0,
        end: producer.length,
        docmeta: {
          returnType: 'number',
          returnsValue: true
        },
        codeRelations: {},
        metaV2: buildSymbolMeta({
          file: 'src/helper.js',
          name: 'helper',
          kind: 'function',
          chunkUid: 'uid-helper'
        })
      }
    ]
  });

  assert.equal(stats.linkedCalls, 1);
  assert.equal(stats.inferredReturns, 1);
};

let failure = null;
try {
  await cleanup(cacheRoots);
  await runWorkerPoolSmoke();
  await runCrossfileSmoke();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  failure = error;
}
await cleanup(cacheRoots);

if (failure) {
  process.exit(failure.exitCode ?? 1);
}
console.log('smoke workers passed');
