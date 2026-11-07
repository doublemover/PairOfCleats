import assert from 'node:assert/strict';
import { appendChunk, createIndexState } from '../../../src/index/build/state.js';
import { appendChargramsToSet } from '../../../src/index/build/state/postings-helpers.js';
import { normalizePostingsConfig } from '../../../src/shared/postings-config.js';

const fields = { name: ['alpha', 'beta'], signature: ['gamma', 'delta'],
  doc: ['epsilon', 'zeta'], comment: ['eta', 'theta'] };
const state = createIndexState();
state.postingsGuard.phrase.maxPerChunk = 1;
state.postingsGuard.chargram.maxPerChunk = 2;
appendChunk(state, { file: 'source.js', tokens: ['alpha'], seq: ['alpha'], fieldTokens: fields }, {
  phraseSource: 'fields', phraseHash: false, phraseMinN: 2, phraseMaxN: 2,
  chargramSource: 'fields', chargramFields: Object.keys(fields), chargramMinN: 2, chargramMaxN: 2
});
assert.deepEqual([...state.phrasePost.keys()], ['alpha\u0001beta']);
assert.equal(state.postingsGuard.phrase.truncatedChunks, 1);
assert.equal(state.triPost.size, 2, 'all fields share the chunk chargram allowance');
const hashes = new Set();
appendChargramsToSet('abc', 2, 2, hashes, 2);
const initial = [...hashes];
appendChargramsToSet('xyz', 2, 2, hashes, 2);
assert.deepEqual([...hashes], initial, 'an exhausted shared set admits no additional hash');

const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12345678';
for (const source of ['full', 'fields']) {
  for (const cap of [undefined, null, 0, false, 48, 128]) {
    const config = normalizePostingsConfig({ chargramSource: source, chargramMaxTokenLength: cap,
      chargramMinN: 3, chargramMaxN: 3, enablePhraseNgrams: false });
    assert.deepEqual(normalizePostingsConfig(config), config, 'normalization must be idempotent');
    const candidate = createIndexState({ postingsConfig: config });
    appendChunk(candidate, { file: 'source.js', tokens: [token], seq: [token],
      fieldTokens: { name: [token] } }, config);
    assert.equal(candidate.triPost.size > 0, cap === null || cap === 0 || cap === false || cap === 128,
      `${source}: long-token evidence follows the configured cap ${String(cap)}`);
  }
}
console.log('shared postings field budgets test passed');
