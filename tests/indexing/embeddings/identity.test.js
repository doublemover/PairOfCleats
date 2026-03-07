#!/usr/bin/env node
import {
  buildEmbeddingIdentity,
  buildEmbeddingIdentityKey
} from '../../../src/shared/embedding-identity.js';

const base = {
  modelId: 'test-model',
  provider: 'onnx',
  mode: 'code',
  stub: false,
  dims: 384,
  scale: 2 / 255,
  pooling: 'mean',
  normalize: true,
  truncation: 'truncate',
  maxLength: null,
  quantization: {
    version: 1,
    minVal: -1,
    maxVal: 1,
    levels: 256
  },
  onnx: {
    modelPath: '/models/model.onnx',
    tokenizerId: 'tokenizer',
    executionProviders: ['cpu'],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'basic'
  }
};

const baseKey = buildEmbeddingIdentityKey(buildEmbeddingIdentity(base));

const modelPathKey = buildEmbeddingIdentityKey(buildEmbeddingIdentity({
  ...base,
  onnx: { ...base.onnx, modelPath: '/models/alt.onnx' }
}));
if (modelPathKey === baseKey) {
  console.error('embedding identity test failed: modelPath change did not update key');
  process.exit(1);
}

const providerKey = buildEmbeddingIdentityKey(buildEmbeddingIdentity({
  ...base,
  onnx: { ...base.onnx, executionProviders: ['cpu', 'cuda'] }
}));
if (providerKey === baseKey) {
  console.error('embedding identity test failed: executionProviders change did not update key');
  process.exit(1);
}

const normalizeKey = buildEmbeddingIdentityKey(buildEmbeddingIdentity({
  ...base,
  normalize: false
}));
if (normalizeKey === baseKey) {
  console.error('embedding identity test failed: normalize change did not update key');
  process.exit(1);
}

const quantKey = buildEmbeddingIdentityKey(buildEmbeddingIdentity({
  ...base,
  quantization: { ...base.quantization, levels: 128 }
}));
if (quantKey === baseKey) {
  console.error('embedding identity test failed: quantization change did not update key');
  process.exit(1);
}

const formattingKey = buildEmbeddingIdentityKey(buildEmbeddingIdentity({
  ...base,
  inputFormatting: {
    family: 'e5',
    queryPrefix: 'query: ',
    passagePrefix: 'passage: '
  }
}));
if (formattingKey === baseKey) {
  console.error('embedding identity test failed: inputFormatting change did not update key');
  process.exit(1);
}

console.log('embedding identity tests passed');
