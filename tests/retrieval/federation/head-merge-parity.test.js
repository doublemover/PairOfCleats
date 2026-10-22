import assert from 'node:assert/strict';
import { mergeFederatedResults } from '../../../src/retrieval/federation/merge.js';

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
        repoPriority: repo.priority ?? 0, rrf: 1 / (rrfK + rank + 1), order: order++ });
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
console.log('Federated head merging preserves the full-sort oracle, including rounded RRF ties.');
