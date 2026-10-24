import assert from 'node:assert/strict';
import { resolveGraphNodeIndexes } from '../../../src/graph/prepared-node-indexes.js';
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';
import { buildContextIndex, serializeContextIndex, hydrateContextIndex, ensureChunkLookups } from '../../../src/retrieval/context-expansion.js';
import { buildCommentLookup, needsCommentExcerpts, attachCommentExcerpts } from '../../../src/retrieval/cli/run-search-session/comment-excerpts.js';
import { computeRelationBoost, createRelationBoostEvaluator } from '../../../src/retrieval/scoring/relation-boost.js';
import { resolveFileRelations } from '../../../src/retrieval/file-relations-resolver.js';

let nodeReads = 0;
const nodes = [{ get id() { nodeReads++; return 'a'; }, out: ['b'], in: [] }, { id: 'b', out: [], in: ['a'] }];
const graph = { callGraph: { nodes }, usageGraph: { nodes: [] } };
const config = { enabled: true, weights: { degree: 1, proximity: 0 }, seedSelection: 'none' };
const entries = [{ idx: 0, score: 1, chunk: { chunkUid: 'a' } }];
const first = applyGraphRanking({ entries, graphRelations: graph, config, explain: true });
const coldReads = nodeReads;
assert.deepEqual(applyGraphRanking({ entries, graphRelations: graph, config, explain: true }), first);
assert.equal(nodeReads, coldReads, 'warm reranking does not rebuild node maps');
assert.notEqual(resolveGraphNodeIndexes({ ...graph }).callGraph, resolveGraphNodeIndexes(graph).callGraph);
assert.equal(entries[0].score, 1, 'cached graph lookup does not annotate source entries');

const meta = [{ id: 0, name: 'alpha', file: 'a.js', chunkUid: 'a' },
  { id: 1, name: 'beta', file: 'a.js', metaV2: { chunkUid: 'b' } }];
const cold = buildContextIndex({ chunkMeta: meta, repoMap: [{ name: 'alpha', file: 'a.js' }] });
const hydrated = hydrateContextIndex(serializeContextIndex(cold));
const maps = [hydrated.byName, hydrated.byFile, hydrated.repoMapByName];
const idOnly = meta.map(chunk => ({ ...chunk, get name() { throw new Error('hydrated names must not be rebuilt'); },
  get file() { throw new Error('hydrated file map must not be rebuilt'); } }));
ensureChunkLookups(hydrated, idOnly);
assert.equal(hydrated.byDocId.size, 2);
assert.equal(hydrated.byChunkUid.get('b'), 1);
assert.deepEqual([hydrated.byName, hydrated.byFile, hydrated.repoMapByName], maps);
assert.equal(hydrated.byName, maps[0]);

let commentReads = 0;
const comments = [{ file: 'a.js', docmeta: { get comments() { commentReads++; return [{ start: 0, end: 1, text: 'fresh' }]; } } }];
assert.equal(needsCommentExcerpts([]), false);
assert.equal(buildCommentLookup({ joinComments: false, extractedChunkMeta: comments }), null);
assert.equal(commentReads, 0);
const lookup = buildCommentLookup({ joinComments: true, extractedChunkMeta: comments });
assert.equal(buildCommentLookup({ joinComments: true, extractedChunkMeta: comments }), lookup);
assert.equal(commentReads, 1);
for (let request = 0; request < 2; request++) {
  const hits = [{ file: 'a.js', docmeta: { commentRefs: [{ start: 0, end: 1 }] } }];
  attachCommentExcerpts({ hits, commentLookup: lookup });
  assert.equal(hits[0].docmeta.commentExcerpt, 'fresh');
  hits[0].docmeta.commentExcerpts[0].text = 'query-local';
}
const replacement = buildCommentLookup({ joinComments: true, extractedChunkMeta: [{ file: 'a.js',
  docmeta: { comments: [{ start: 0, end: 1, text: 'next generation' }] } }] });
assert.notEqual(replacement, lookup);

let usageReads = 0;
const usages = new Proxy(['target'], { get(target, key, receiver) {
  if (key === '0') usageReads++;
  return Reflect.get(target, key, receiver);
} });
const relations = { calls: [['caller', 'pkg.target']], usages };
const relationConfig = { enabled: true, lexiconEnabled: false };
const evaluate = createRelationBoostEvaluator({ queryTokens: ['target'], config: relationConfig });
const expected = computeRelationBoost({ chunk: {}, fileRelations: relations, queryTokens: ['target'], config: relationConfig });
usageReads = 0;
assert.deepEqual(evaluate({ chunk: {}, fileRelations: relations }), expected);
const preparedReads = usageReads;
assert.deepEqual(evaluate({ chunk: {}, fileRelations: relations }), expected);
assert.equal(usageReads, preparedReads, 'effective shared relation arrays are tokenized once per request');
assert.equal(evaluate({ chunk: { usages: ['different'] }, fileRelations: relations }).usageMatches, 0);
const store = new Map([['A.js', relations]]);
assert.equal(resolveFileRelations(store, 'a.js'), relations);
store.set('A.js', { usages: ['changed'] });
assert.deepEqual(resolveFileRelations(store, 'a.js'), { usages: ['changed'] });
store.set('a.JS', { usages: ['ambiguous'] });
assert.equal(resolveFileRelations(store, 'a.js'), null, 'mutable maps re-evaluate new case collisions');
console.log('Generation and request lookup preparation preserves identity, freshness and query isolation.');
