import assert from 'node:assert/strict';
import { mergeFederatedResults } from '../../../src/retrieval/federation/merge.js';
import { MinHeap } from '../../../src/shared/min-heap.js';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const oracle = ({ perRepoResults, topN = 10, perRepoTop = 20, rrfK = 60 }) => {
  const output = {};
  for (const mode of ['code', 'prose', 'extractedProse', 'records']) {
    let order = 0;
    const all = [];
    for (const repo of perRepoResults) {
      const hits = (repo.result?.[mode] || []).slice(0, Math.max(0, perRepoTop));
      for (let rank = 0; rank < hits.length; rank++) all.push({ ...hits[rank], repoId: repo.repoId,
        repoAlias: repo.repoAlias || null, globalId: `${repo.repoId}:${hits[rank].id}`,
        repoPriority: repo.priority ?? 0, rrf: 1 / (rrfK + (rank + 1)), order: order++ });
    }
    all.sort((a, b) => b.rrf - a.rrf || finite(b.repoPriority) - finite(a.repoPriority)
      || String(a.repoId || '').localeCompare(String(b.repoId || ''))
      || String(a.id || '').localeCompare(String(b.id || ''))
      || String(a.file || '').localeCompare(String(b.file || ''))
      || finite(a.start) - finite(b.start) || a.order - b.order);
    output[mode] = all.slice(0, Math.max(0, topN)).map(({ rrf, order: ignored, ...hit }) => ({ ...hit,
      sourceScore: hit.score, sourceScoreType: hit.scoreType || null,
      score: Number(rrf.toFixed(12)), scoreType: 'federated_rrf', rankMethod: 'reciprocal-rank', repoPriority: hit.repoPriority }));
  }
  return output;
};
let payloadReads = 0;
const repos = Array.from({ length: 100 }, (_, repo) => ({ repoId: `repo-${repo}`, priority: repo % 3,
  result: { code: Array.from({ length: 20 }, (_, rank) => ({ id: `id-${rank}`, file: `${rank}.js`, start: rank,
    score: rank % 4 ? rank : null, scoreType: 'bm25', get payload() { payloadReads++; return { repo, rank }; } })) } }));
const expected = oracle({ perRepoResults: repos });
payloadReads = 0;
assert.deepEqual(mergeFederatedResults({ perRepoResults: repos }), expected);
assert.equal(payloadReads, 10, 'only retained candidates copy full payloads');
payloadReads = 0;
assert.deepEqual(mergeFederatedResults({ perRepoResults: repos, topN: 0 }), { code: [], prose: [], extractedProse: [], records: [] });
assert.equal(payloadReads, 0);
for (let seed = 0; seed < 72; seed++) {
  const perRepoResults = Array.from({ length: seed % 7 }, (_, repo) => ({ repoId: `r${repo % 3}`, priority: repo % 2,
    result: Object.fromEntries(['code', 'prose', 'extractedProse', 'records'].map(mode => [mode,
      Array.from({ length: (seed + repo) % 9 }, (_, rank) => ({ id: `${9 - rank}`, file: `${rank % 3}.js`,
        start: rank % 2, score: rank % 3 ? rank : NaN }))])) }));
  const options = { perRepoResults, topN: seed % 11, perRepoTop: seed % 6,
    rrfK: seed % 3 ? 60 : Number.MAX_VALUE };
  assert.deepEqual(mergeFederatedResults(options), oracle(options));
}
const tied = { perRepoResults: [{ repoId: 'r', result: { code: [{ id: 'z' }, { id: 'a' }] } }],
  rrfK: Number.MAX_VALUE, topN: 1 };
assert.equal(mergeFederatedResults(tied).code[0].id, 'a', 'rounded RRF ties take comparator-preserving fallback');
for (const rrfK of [2 ** 52 - 1, 2 ** 53 - 1, 2 ** 53, 2 ** 54, 1e100, Number.MAX_VALUE]) {
  const options = { perRepoResults: [{ repoId: 'same', priority: Infinity,
    result: Object.fromEntries(['code', 'prose', 'extractedProse', 'records'].map(mode => [mode,
      Array.from({ length: 500 }, (_, rank) => ({ id: String(500 - rank).padStart(4, '0'),
        file: `${rank % 2}.js`, start: rank % 3, score: rank }))])) }], topN: 7, perRepoTop: 500, rrfK };
  assert.deepEqual(mergeFederatedResults(options), oracle(options), 'bounded fallback retains precision-boundary and all-mode parity');
}
const originalPush = MinHeap.prototype.push;
let maxRetained = 0;
try {
  MinHeap.prototype.push = function (value) {
    originalPush.call(this, value);
    maxRetained = Math.max(maxRetained, this.size);
  };
  const options = { perRepoResults: [{ repoId: 'one', result: { code: Array.from({ length: 1000 }, (_, rank) => ({ id: 1000 - rank })) } }],
    topN: 7, perRepoTop: 1000, rrfK: Number.MAX_VALUE };
  assert.deepEqual(mergeFederatedResults(options), oracle(options));
  assert.equal(maxRetained, 7, 'an unordered rounded stream retains only the requested top-N descriptors');
} finally { MinHeap.prototype.push = originalPush; }
console.log('Federated head merging preserves the full-sort oracle, including rounded RRF ties.');
