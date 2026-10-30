import assert from 'node:assert/strict';
import { createCandidateSetBuilder } from '../../../src/retrieval/pipeline/candidates.js';
import { createCandidateHelpers } from '../../../src/retrieval/output/filters/candidates.js';
import { createAlphaSearchIndex, createSearchPipelineFixture } from '../helpers/search-pipeline-fixture.js';
let visits = 0;
const posting = Array.from({ length: 10 }, (_, id) => id);
posting[Symbol.iterator] = function* () { for (let id = 0; id < 10; id++) { visits++; yield id; } };
const builder = createCandidateSetBuilder({ useSqlite: false, postingsConfig: { enablePhraseNgrams: false,
  chargramMinN: 3, chargramMaxN: 3 }, maxCandidates: 100 });
assert.deepEqual([...builder({ chargrams: { vocab: ['aaa'], postings: [posting] } }, ['aaaaaaaaaa', 'aaaaaaaaaa'], 'code')],
  Array.from({ length: 10 }, (_, id) => id));
assert.equal(visits, 10, 'each gram posting is visited once despite repeated grams and query tokens');
const broad = new Set(Array.from({ length: 10000 }, (_, id) => id)), tiny = new Set([9999]);
let checks = 0;
broad.has = function (id) { checks++; return Set.prototype.has.call(this, id); };
const helpers = createCandidateHelpers({ roaringAvailable: false });
assert.deepEqual([...helpers.intersectCandidates([{ set: broad }, { set: tiny }])], [9999]);
assert.equal(checks, 1, 'a tiny late filter drives the intersection');
assert.deepEqual([...helpers.intersectTwoSets(new Set([4, 1]), new Set([1, 4]))], [1, 4]);
const index = createAlphaSearchIndex();
Object.defineProperty(index, 'chargrams', { get() { throw new Error('independent/sparse routes must not build lexical gram unions'); } });
for (const annEnabled of [false, true]) {
  const pipeline = createSearchPipelineFixture({ annEnabled, annDiscovery: 'independent' });
  assert.ok(Array.isArray(await pipeline(index, 'code', null)));
}
console.log('Candidate preparation follows consumer demand and small admitted filter domains.');
