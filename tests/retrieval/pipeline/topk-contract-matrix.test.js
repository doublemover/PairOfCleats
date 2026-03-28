#!/usr/bin/env node
import assert from 'node:assert/strict';

import { compareTopKEntries, createTopKReducer, selectTopK } from '../../../src/retrieval/pipeline/topk.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const cases = [
  {
    name: 'sorted top-k reducer cuts off early without changing winners',
    run() {
      const total = 2000;
      const k = 8;
      const items = Array.from({ length: total }, (_, index) => ({
        idx: index,
        score: total - index,
        sourceRank: index
      }));

      const reducer = createTopKReducer({ k, sorted: true });
      for (const item of items) {
        const stop = reducer.pushRaw(item.score, item.idx, item.sourceRank);
        if (stop) break;
      }

      const result = reducer.finish({ limit: k });
      const baseline = items
        .slice()
        .sort((a, b) => compareTopKEntries(
          { score: a.score, id: a.idx, sourceRank: a.sourceRank },
          { score: b.score, id: b.idx, sourceRank: b.sourceRank }
        ))
        .slice(0, k);

      assert.ok(reducer.stats.cutoffs > 0);
      assert.deepEqual(
        result.map((entry) => ({ idx: entry.idx, score: entry.score })),
        baseline.map((entry) => ({ idx: entry.idx, score: entry.score }))
      );
    }
  },
  {
    name: 'heap path plateaus memory near k plus slack',
    run() {
      const total = 50_000;
      const k = 10;
      const slack = 5;
      const reducer = createTopKReducer({ k, slack, sorted: true });

      for (let index = 0; index < total; index += 1) {
        const stop = reducer.pushRaw(total - index, index, index);
        if (stop) break;
      }

      assert.equal(reducer.stats.usedHeap, true);
      assert.ok(reducer.stats.maxSize <= k + slack);
    }
  },
  {
    name: 'selectTopK fastpath matches full sort order',
    run() {
      const items = Array.from({ length: 500 }, (_, index) => ({
        idx: index,
        score: ((index * 73) % 97) + (index % 5) * 0.01
      }));
      const k = 5;
      const stats = {};
      const result = selectTopK(items, {
        k,
        score: (item) => item.score,
        id: (item) => item.idx,
        sourceRank: (_, index) => index,
        stats
      });

      const expected = items
        .map((item, index) => ({
          item,
          score: item.score,
          id: item.idx,
          sourceRank: index
        }))
        .sort(compareTopKEntries)
        .slice(0, k)
        .map((entry) => entry.item.idx);

      assert.deepEqual(result.map((item) => item.idx), expected);
      assert.equal(stats.usedHeap, true);
      assert.equal(stats.usedSort, false);
    }
  },
  {
    name: 'selectTopK matches deterministic baselines across randomized seeds',
    run() {
      const makeRng = (seed) => {
        let state = seed >>> 0;
        return () => {
          state = (state * 1664525 + 1013904223) >>> 0;
          return state / 0xffffffff;
        };
      };

      const buildExpected = (items, k) => items
        .map((item, index) => ({
          item,
          score: item.score,
          id: item.idx,
          sourceRank: index
        }))
        .slice()
        .sort(compareTopKEntries)
        .slice(0, k)
        .map((entry) => entry.item.idx);

      for (const seed of [11, 42, 1337]) {
        const rng = makeRng(seed);
        const items = Array.from({ length: 200 }, (_, index) => ({
          idx: index,
          score: Math.round(rng() * 1000) / 1000
        }));
        const result = selectTopK(items, {
          k: 15,
          score: (item) => item.score,
          id: (item) => item.idx,
          sourceRank: (_, index) => index
        });
        assert.deepEqual(result.map((item) => item.idx), buildExpected(items, 15), `seed ${seed}`);
      }
    }
  },
  {
    name: 'tie-breaks remain deterministic across mixed id types and duplicate ids',
    run() {
      const items = [
        { idx: 'b', score: 1 },
        { idx: 2, score: 1 },
        { idx: 'a', score: 1 },
        { idx: 1, score: 1 },
        { idx: 1, score: 1, label: 'second-dup' }
      ];

      const expected = items
        .map((item, index) => ({
          item,
          score: item.score,
          id: item.idx,
          sourceRank: index
        }))
        .slice()
        .sort(compareTopKEntries)
        .map((entry) => entry.item);

      const result = selectTopK(items, {
        k: items.length,
        score: (item) => item.score,
        id: (item) => item.idx,
        sourceRank: (_, index) => index
      });

      assert.deepEqual(result.map((item) => item.idx), expected.map((item) => item.idx));
      assert.equal(
        result.findIndex((item) => item.label === 'second-dup') > result.findIndex((item) => item.idx === 1),
        true
      );
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('topk contract matrix test passed');
