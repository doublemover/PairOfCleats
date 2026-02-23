#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveEmbeddingsPersistentTextCacheVectorEncoding } from '../../../tools/build/embeddings/runner.js';

assert.equal(
  resolveEmbeddingsPersistentTextCacheVectorEncoding({ embeddings: {} }),
  'float32',
  'expected float32 default encoding'
);

assert.equal(
  resolveEmbeddingsPersistentTextCacheVectorEncoding({ embeddings: { persistentTextCacheVectorEncoding: 'float16' } }),
  'float16',
  'expected explicit float16 encoding override'
);

assert.equal(
  resolveEmbeddingsPersistentTextCacheVectorEncoding({ embeddings: { persistentTextCacheVectorEncoding: 'FP16' } }),
  'float16',
  'expected fp16 alias to normalize to float16'
);

assert.equal(
  resolveEmbeddingsPersistentTextCacheVectorEncoding({ embeddings: { persistentTextCacheVectorEncoding: 'not-a-real-mode' } }),
  'float32',
  'expected unknown values to fall back to float32'
);

console.log('embeddings persistent text cache vector encoding resolver test passed');
