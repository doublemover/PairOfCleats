#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  __buildSessionOptionsForTests,
  __tokenizeBatchWithCacheForTests,
  normalizeOnnxConfig
} from '../../../src/shared/onnx-embeddings.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const onnxEnvOverrides = {
  PAIROFCLEATS_ONNX_CPU_EP_TUNING: undefined,
  PAIROFCLEATS_ONNX_TOKENIZATION_CACHE: undefined,
  PAIROFCLEATS_ONNX_TOKENIZATION_CACHE_MAX: undefined,
  PAIROFCLEATS_ONNX_PREWARM_TOKENIZER: undefined,
  PAIROFCLEATS_ONNX_PREWARM_MODEL: undefined,
  PAIROFCLEATS_ONNX_PREWARM_TEXTS: undefined
};

await withTemporaryEnv(onnxEnvOverrides, async () => {
  const safeDefaults = __buildSessionOptionsForTests({}, { lowMemory: false });
  assert.deepEqual(
    safeDefaults,
    {
      executionProviders: [{ name: 'cpu', useArena: false }],
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      graphOptimizationLevel: 'basic',
      enableCpuMemArena: false,
      enableMemPattern: false,
      executionMode: 'sequential'
    },
    'expected safe CPU session defaults for ONNX provider'
  );

  const optOutDefaults = __buildSessionOptionsForTests(
    { cpuExecutionProviderTuning: false },
    { lowMemory: false }
  );
  assert.equal(optOutDefaults, undefined, 'expected CPU tuning opt-out to preserve runtime defaults');

  await withTemporaryEnv({
    PAIROFCLEATS_ONNX_CPU_EP_TUNING: '0',
    PAIROFCLEATS_ONNX_TOKENIZATION_CACHE: '0',
    PAIROFCLEATS_ONNX_TOKENIZATION_CACHE_MAX: '8',
    PAIROFCLEATS_ONNX_PREWARM_TOKENIZER: '1',
    PAIROFCLEATS_ONNX_PREWARM_MODEL: '1',
    PAIROFCLEATS_ONNX_PREWARM_TEXTS: 'alpha,alpha,beta'
  }, async () => {
    const normalized = normalizeOnnxConfig({});
    assert.equal(normalized.cpuExecutionProviderTuning, false, 'expected env CPU tuning override');
    assert.equal(normalized.tokenizationCacheEnabled, false, 'expected env tokenization cache override');
    assert.equal(normalized.tokenizationCacheMaxEntries, 8, 'expected env tokenization cache max override');
    assert.equal(normalized.prewarmTokenizer, true, 'expected env tokenizer prewarm override');
    assert.equal(normalized.prewarmModel, true, 'expected env model prewarm override');
    assert.deepEqual(normalized.prewarmTexts, ['alpha', 'beta'], 'expected deterministic prewarm text normalization');
  });

  let tokenizerCalls = 0;
  const tokenizer = (texts, { return_token_type_ids: wantsTokenTypeIds } = {}) => {
    tokenizerCalls += 1;
    const rows = texts.map((text) => [text.length + 10, text.length + 11]);
    const masks = texts.map(() => [1, 1]);
    const types = texts.map(() => [0, 0]);
    return {
      input_ids: rows,
      attention_mask: masks,
      token_type_ids: wantsTokenTypeIds ? types : undefined
    };
  };
  tokenizer.pad_token_id = 7;

  const tokenizationCache = {
    enabled: true,
    maxEntries: 16,
    cache: new Map()
  };

  const first = __tokenizeBatchWithCacheForTests({
    tokenizer,
    texts: ['alpha', 'beta', 'alpha'],
    wantsTokenTypeIds: false,
    tokenizationCache
  });
  assert.equal(tokenizerCalls, 1, 'expected one tokenizer call for first unique batch');
  assert.deepEqual(first.input_ids[0], first.input_ids[2], 'expected duplicate texts to reuse token rows');

  const second = __tokenizeBatchWithCacheForTests({
    tokenizer,
    texts: ['beta', 'alpha'],
    wantsTokenTypeIds: false,
    tokenizationCache
  });
  assert.equal(tokenizerCalls, 1, 'expected repeated texts to hit tokenization cache across calls');
  assert.deepEqual(second.attention_mask, [[1, 1], [1, 1]], 'expected deterministic padding/mask output');

  __tokenizeBatchWithCacheForTests({
    tokenizer,
    texts: ['alpha'],
    wantsTokenTypeIds: true,
    tokenizationCache
  });
  assert.equal(tokenizerCalls, 2, 'expected token-type-id mode to use a separate cache key');
});

console.log('onnx cpu tuning and tokenization cache test passed');
