import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildPostings } from '../../../src/index/build/postings.js';
import { createIndexState, appendChunk } from '../../../src/index/build/state.js';
import { hashTokenId } from '../../../src/shared/token-id.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// AUTHORED actual default buildPostings route, real collector/runs/merge. UNRUN.
const { dir } = await prepareIsolatedTestCacheDir('phrase-hash-adaptive-spill');
const count = 6001;
const fixture = ({ hashed, collision }) => {
  const tokenIdMap = new Map([['anchor', 'anchor']]);
  const phrasePost = new Map(), phrasePostHashBuckets = new Map();
  const collisionEntries = [];
  for (let i = count - 1; i >= 0; i--) {
    const id = `id-${i}`;
    const token = `term-${String(i).padStart(5, '0')}-😀`;
    tokenIdMap.set(id, token);
    const posting = [i % 7, i % 7, (i + 1) % 7];
    if (hashed) {
      const entry = { ids: [id, 'anchor'], posting };
      if (collision) collisionEntries.push(entry);
      else phrasePostHashBuckets.set(i, { kind: 'single', ...entry });
    } else phrasePost.set(`${token}\u0001anchor`, posting);
  }
  if (hashed && collision) phrasePostHashBuckets.set('forced-collision', { kind: 'collision', entries: collisionEntries });
  return { tokenIdMap, phrasePost, phrasePostHashBuckets };
};
const digest = result => createHash('sha256').update(JSON.stringify([result.phraseVocab, result.phrasePostings])).digest('hex');
try {
  let expected = null;
  for (const collision of [false, true]) {
    for (const hashed of [false, true]) {
      for (const trigger of ['none', 'unique', 'bytes']) {
        const root = path.join(dir, `${collision}-${hashed}-${trigger}`);
        await fs.mkdir(root, { recursive: true });
        const source = fixture({ hashed, collision });
        const result = await buildPostings({ ...source,
          chunks: [{ tokens: ['anchor'], tokenCount: 1 }],
          tokenPostings: new Map(), docLengths: [1],
          postingsConfig: { enableChargrams: false, fielded: false,
            // Omission exercises the real default phraseHash=true resolver.
            ...(hashed ? {} : { phraseHash: false }),
            phraseSpillMaxUnique: trigger === 'unique' ? 4000 : 0,
            phraseSpillMaxBytes: trigger === 'bytes' ? 1 : 0 },
          buildRoot: root, embeddingsEnabled: false });
        expected ??= digest(result);
        assert.equal(digest(result), expected, `exact output parity: ${collision}/${hashed}/${trigger}`);
        assert.equal(result.phraseVocab.length, count);
        const stats = result.phraseStats;
        assert.equal(stats.source, hashed ? 'hashed-buckets' : 'string-map');
        assert.equal(stats.inputRows, count, 'collision phrases are individual admitted rows');
        assert.equal(stats.inputHashBuckets, hashed ? (collision ? 1 : count) : 0);
        assert.equal(stats.inputStringEntries, hashed ? 0 : count);
        assert.equal(stats.finalRows, count);
        assert.equal(stats.inputBucketBytes, null);
        assert.equal(stats.finalArrayBytes, null);
        assert.equal(source.phrasePost.size, 0);
        assert.equal(source.phrasePostHashBuckets.size, 0);
        if (trigger === 'none') {
          assert.equal(stats.spillEnabled, false);
          assert.equal(stats.spillRuns, 0);
          assert.equal(result.postingsMergeStats.phrase, null);
        } else {
          assert.equal(stats.spillEnabled, true);
          assert.equal(stats.spillRuns, 2, 'actual 5000-row collector runs, not just an enabled flag');
          assert.equal(result.postingsMergeStats.phrase.runs, 2);
          assert.equal(result.postingsMergeStats.phrase.rows, count, 'actual merged rows consumed');
          assert.equal(stats.spillRows, count);
          assert.equal(stats.spillBytes, stats.inputSerializedBytes);
          assert.ok(stats.collectorBufferHighWaterRows <= stats.collectorMaxRows);
          assert.ok(stats.collectorBufferHighWaterBytes < stats.collectorMaxBytes + stats.maxRowBytes);
          if (trigger === 'bytes') {
            assert.equal(stats.adaptiveBufferHighWaterRows, 1);
            assert.ok(stats.adaptiveBufferHighWaterBytes <= stats.maxRowBytes);
          }
          if (trigger === 'unique' && hashed && collision) assert.equal(stats.adaptiveBufferHighWaterRows, 4000);
        }
        assert.deepEqual(await fs.readdir(root), [], 'original runs and merge outputs retired');
      }
    }
  }

  // Production state accumulation also selects hashing without an explicit knob.
  const config = { phraseSource: 'full', phraseMinN: 2, phraseMaxN: 2, enableChargrams: false };
  const state = createIndexState({ postingsConfig: config });
  const tokens = ['alpha', 'beta', 'alpha', 'beta'];
  appendChunk(state, { file: 'source.js', tokens, seq: tokens, tokenIds: tokens.map(token => hashTokenId(token)) }, config);
  assert.ok(state.phrasePostHashBuckets.size > 0);
  const result = await buildPostings({ ...state, postingsConfig: config, embeddingsEnabled: false });
  assert.equal(result.phraseStats.source, 'hashed-buckets');
  assert.deepEqual(result.phraseVocab, ['alpha\u0001beta', 'beta\u0001alpha']);
  assert.deepEqual(result.phrasePostings, [[0], [0]]);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('default hashed phrase rows share exact adaptive thresholds and actual spill merge ownership');
