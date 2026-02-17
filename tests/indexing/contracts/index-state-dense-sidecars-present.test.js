#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { buildIndexStateArtifactsBlock } from '../../../src/index/build/index-state-profile.js';

applyTestEnv();

const baseInput = {
  profileId: 'default',
  postingsConfig: {
    enablePhraseNgrams: true,
    enableChargrams: true
  }
};

const codeDense = buildIndexStateArtifactsBlock({
  ...baseInput,
  mode: 'code',
  embeddingsEnabled: true
});
assert.equal(codeDense.present.dense_vectors, true, 'expected dense_vectors to be present when embeddings are emitted');
assert.equal(codeDense.present.dense_vectors_doc, true, 'expected dense_vectors_doc sidecar to be present for code mode');
assert.equal(codeDense.present.dense_vectors_code, true, 'expected dense_vectors_code sidecar to be present for code mode');

const proseDense = buildIndexStateArtifactsBlock({
  ...baseInput,
  mode: 'prose',
  embeddingsEnabled: true
});
assert.equal(proseDense.present.dense_vectors, true, 'expected dense_vectors to be present for prose mode');
assert.equal(proseDense.present.dense_vectors_doc, true, 'expected dense_vectors_doc sidecar to be present for prose mode');
assert.equal(proseDense.present.dense_vectors_code, true, 'expected dense_vectors_code sidecar to be present for prose mode');

const embeddingsOff = buildIndexStateArtifactsBlock({
  ...baseInput,
  mode: 'code',
  embeddingsEnabled: false
});
assert.equal(embeddingsOff.present.dense_vectors, false, 'expected dense_vectors to be absent when embeddings are not emitted');
assert.equal(embeddingsOff.present.dense_vectors_doc, false, 'expected dense_vectors_doc to be absent when embeddings are not emitted');
assert.equal(embeddingsOff.present.dense_vectors_code, false, 'expected dense_vectors_code to be absent when embeddings are not emitted');

console.log('index state dense sidecars present test passed');
