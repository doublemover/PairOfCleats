import assert from 'node:assert/strict';
import { createRrfFrontier } from '../../../src/retrieval/sessions/rrf-frontier.js';
import { openCompleteListRrfSession } from '../../../src/retrieval/sessions/complete-list.js';

const target = (weights = [1, 1]) => ({
  formula: 'weighted-rrf-v1', numericEvaluation: 'binary64-channel-order-v1', certificateTarget: 'pre-boost', rankDomain: 'after-filter',
  resultUnit: 'source-incarnation', tiePolicy: 'code-unit-id', zeroSupport: 'exclude',
  eligibility: 'complete-confirmed', repositoryId: 'repo', generationId: 'build-1',
  universeId: 'eligible-1', queryId: 'query-1', semanticWorldId: 'world-1',
  semanticSpecId: 'predicate-1', eligibilityReceiptId: 'proof-1', k: 60,
  channels: weights.map((weight, i) => ({ id: `c${i}`, representationId: `r${i}`,
    capability: 'exact-ordered-prefix', weight }))
});
// Independent full-list computation: no frontier implementation or shared rank helper.
const exhaustive = (spec, lists) => {
  const ids = new Set(Object.values(lists).flat());
  return [...ids].map(id => ({ id, score: spec.channels.reduce((sum, channel) => {
    const index = lists[channel.id].indexOf(id);
    return sum + (index < 0 ? 0 : channel.weight / (spec.k + index + 1));
  }, 0) })).filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};
const compareRun = (spec, lists, workBudget, pageSize) => {
  const expected = exhaustive(spec, lists);
  const session = openCompleteListRrfSession({ target: spec, lists });
  const observed = [];
  let continuation;
  for (let turn = 0; turn < 1000; turn++) {
    const page = session.advance({ workBudget, pageSize, continuation });
    continuation = page.continuation;
    for (const hit of page.hits) {
      const reference = expected[observed.length];
      assert.equal(hit.id, reference.id, 'every early certificate must match the exhaustive prefix');
      assert.ok(hit.scoreInterval.lower <= reference.score && reference.score <= hit.scoreInterval.upper);
      if (hit.scoreStatus === 'exact') assert.equal(hit.scoreInterval.lower, reference.score);
      observed.push(hit.id);
    }
    if (page.enumerationComplete && !page.hits.length) break;
    assert.notEqual(turn, 999, 'session must finish without losing a frontier');
  }
  assert.deepEqual(observed, expected.map(hit => hit.id));
  session.close();
};
const antiCorrelated = { c0: ['a', 'b', 'winner', 'd', 'e'], c1: ['e', 'd', 'winner', 'b', 'a'] };
for (const work of [1, 2, 17]) for (const page of [1, 3, 20]) compareRun(target(), antiCorrelated, work, page);
compareRun(target([1, 0]), { c0: ['b', 'a'], c1: ['only-zero', 'a'] }, 1, 1);
compareRun(target(), { c0: [], c1: [] }, 1, 2);
compareRun(target(), { c0: ['z', 'a'], c1: ['a', 'z'] }, 1, 1);

let seed = 42;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
for (let trial = 0; trial < 60; trial++) {
  const lists = {};
  for (const channel of ['c0', 'c1']) {
    const ids = Array.from({ length: 12 }, (_, i) => `id-${i}`).filter(() => random() > .2);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    lists[channel] = ids;
  }
  compareRun(target(), lists, 1 + trial % 4, 1 + trial % 3);
}

const weighted = target([100, 1]);
weighted.k = 0;
const frontier = createRrfFrontier({ target: weighted });
frontier.append({ channelId: 'c0', expectedDepth: 0, ids: ['a'] });
const early = frontier.takeCertified(1).hits[0];
assert.equal(early.id, 'a');
assert.equal(early.scoreStatus, 'interval', 'certified order does not imply a point score');
assert.deepEqual(early.scoreInterval, { lower: 100, upper: 101 });
assert.throws(() => frontier.append({ channelId: 'c0', expectedDepth: 0, ids: ['a'] }), /prefix/);
assert.throws(() => frontier.append({ channelId: 'c0', expectedDepth: 1, ids: ['b', 'b'] }), /Duplicate/);
assert.equal(frontier.receipt().channels[0].depth, 1, 'batch validation is atomic');
assert.throws(() => frontier.assertContinuation(frontier.receipt().continuation, 'other-generation'), /incompatible/);
frontier.fail('shard-unavailable');
assert.equal(frontier.receipt().enumerationComplete, false);
assert.deepEqual(frontier.takeCertified(3).hits, []);

const capped = openCompleteListRrfSession({ target: target(), lists: antiCorrelated, maxRetainedBytes: 1 });
assert.equal(capped.advance().reason, 'retained-byte-allowance');
capped.setCapacity(100000);
const resumed = capped.advance({ workBudget: 100, pageSize: 100 });
assert.deepEqual(resumed.hits.map(hit => hit.id), exhaustive(target(), antiCorrelated).map(hit => hit.id));
capped.close();

let releases = 0;
const controller = new AbortController();
const cancelled = openCompleteListRrfSession({ target: target(), lists: antiCorrelated, release: () => releases++ });
controller.abort();
const paused = cancelled.advance({ signal: controller.signal });
assert.equal(paused.state, 'paused');
assert.equal(paused.enumerationComplete, false);
assert.equal(paused.work, 0);
assert.deepEqual(cancelled.advance({ continuation: paused.continuation, workBudget: 100, pageSize: 100 })
  .hits.map(hit => hit.id), exhaustive(target(), antiCorrelated).map(hit => hit.id));
cancelled.close();
cancelled.close();
assert.equal(releases, 1);
assert.throws(() => cancelled.advance(), /closed/);
const approximate = target();
approximate.channels[1].capability = 'approximate-discovery';
assert.throws(() => createRrfFrontier({ target: approximate }), /approximate/);
assert.throws(() => createRrfFrontier({ target: { ...target(), queryId: 'x'.repeat(4097) } }), /identity/);
assert.throws(() => createRrfFrontier({ target: target(Array(33).fill(1)) }), /32/);
let rejectedReleases = 0;
assert.throws(() => openCompleteListRrfSession({ target: target(), lists: antiCorrelated,
  maxListBytes: 1, release: () => rejectedReleases++ }), /allowance/);
assert.equal(rejectedReleases, 0, 'lease ownership transfers only after successful construction');
console.log('anytime RRF frontier contract passed');
