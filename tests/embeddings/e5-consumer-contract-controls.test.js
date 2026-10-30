import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { E5_BOUNDARY_SOURCE, buildE5BoundaryCases } from './helpers/e5-truncation-cohort.js';
import { assertE5GenerationIdentity } from './helpers/e5-generation-consumers.js';
import { buildEmbeddingIdentity, buildEmbeddingIdentityKey } from '../../src/shared/embedding-identity.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
// Authored metadata/identity controls only; no tokenizer, model, factory or
// production index is executed by this ordinary focused fixture.
const bytes = await fs.readFile(E5_BOUNDARY_SOURCE.path);
assert.equal(createHash('sha256').update(bytes).digest('hex'), E5_BOUNDARY_SOURCE.sha256);
const fixture = JSON.parse(bytes.toString('utf8'));
assert.deepEqual(fixture.queryPrefixTokenIds, [360, 36716, 12, 77878, 19, 10, 18151, 33938, 41, 1294, 4, 456, 3996, 3134,
  29191, 31344, 18151, 707, 209806, 46692, 7, 450, 35166, 70, 41, 1294, 58836, 53, 12]);
for (const kind of ['documents', 'queries']) {
  const rows = buildE5BoundaryCases(fixture, kind);
  assert.deepEqual(rows.map(row => row.tokensBeforeTruncation), [511, 512, 513, 512]);
  assert.deepEqual(rows.map(row => row.ids.length), [511, 512, 512, 512]);
  assert.deepEqual(rows[1].ids, rows[2].ids, 'the beyond-boundary b is discarded without losing EOS');
  assert.notDeepEqual(rows[1].ids, rows[3].ids, 'the admitted b changes the last payload token');
  assert.equal(rows[3].ids.at(-2), 876); assert.equal(rows[3].ids.at(-1), 2);
  assert(rows.every(row => row.ids[0] === 0));
  if (kind === 'queries') assert(rows.every(row => row.text.startsWith(fixture.queryPrefix)));
  else assert(rows.every(row => row.text === row.raw));
}
const artifact = { status: 'verified', reuse: 'allow', digest: 'a'.repeat(64),
  revision: 'c9e87c786ffac96aeaeb42863276930883923ecb', inventory: [] };
const identity = buildEmbeddingIdentity({ modelId: 'intfloat/multilingual-e5-large-instruct', provider: 'xenova',
  dims: 1024, mode: 'inline', modelArtifact: artifact });
const state = { embeddings: { ready: true, embeddingIdentity: identity, embeddingIdentityKey: buildEmbeddingIdentityKey(identity) } };
assert.deepEqual(assertE5GenerationIdentity(state, artifact), identity);
for (const change of [value => { value.embeddings.embeddingIdentity.inputFormatting.queryPrefix = 'query: '; },
  value => { value.embeddings.embeddingIdentity.acquisition.dtype = 'q8'; },
  value => { value.embeddings.embeddingIdentityKey = 'legacy'; }, value => { value.embeddings.ready = false; }]) {
  const changed = structuredClone(state); change(changed);
  assert.throws(() => assertE5GenerationIdentity(changed, artifact));
}
console.log('Independent E5 boundary metadata and persisted-generation identity controls passed;no real-model acceptance implied.');
