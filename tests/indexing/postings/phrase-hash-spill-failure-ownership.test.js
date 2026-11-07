import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPhraseAndChargramPostings } from '../../../src/index/build/postings/phrase-chargram.js';
import { compareChargramRows, createSpillHelpers } from '../../../src/index/build/postings/spill.js';
import { createRowSpillCollector } from '../../../src/index/build/artifacts/helpers.js';
import { DEFAULT_MAX_OPEN_RUNS, writeJsonlRunFile } from '../../../src/shared/merge.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// AUTHORED original collector/planner/reader cleanup controls. UNRUN.
const { dir } = await prepareIsolatedTestCacheDir('phrase-hash-spill-failure-ownership');
const source = () => new Map(Array.from({ length: 5001 }, (_, i) =>
  [i, { kind: 'single', ids: [`term-${String(i).padStart(5, '0')}`, 'anchor'], posting: [i] }]));
const options = (buildRoot, buckets) => ({ phraseEnabled: true, phraseHashEnabled: true,
  phrasePostHashBuckets: buckets, phraseSpillMaxUnique: 1, buildRoot,
  compareChargramRows, ...createSpillHelpers({ buildRoot }) });
try {
  for (const mode of ['yield-failure', 'cancel']) {
    const root = path.join(dir, mode); await fs.mkdir(root);
    const buckets = source(), primary = new Error('cooperative yield failed after a real run');
    const controller = new AbortController();
    let yielded = 0, runObserved = false;
    const failure = buildPhraseAndChargramPostings({ ...options(root, buckets), abortSignal: controller.signal,
      requestYield() {
        if (++yielded !== 5000) return null;
        return (async () => {
          const runs = await fs.readdir(path.join(root, 'phrase_postings.runs'));
          assert.equal(runs.length, 1, 'the original run exists before failure');
          runObserved = true;
          if (mode === 'cancel') controller.abort(); else throw primary;
        })();
      } });
    if (mode === 'cancel') await assert.rejects(failure, { name: 'AbortError' });
    else await assert.rejects(failure, error => error === primary);
    assert.equal(runObserved, true);
    assert.equal(buckets.has(5000), true, 'unaccepted source row retains its original bucket');
    if (mode === 'yield-failure') assert.equal(buckets.has(4999), true, 'failure before iterator advance retains current row');
    assert.deepEqual(await fs.readdir(root), [], 'append/yield cleanup never needs successful finalize');
  }

  // Independent cleanup remains possible when a write fails with rows buffered.
  const appendRoot = path.join(dir, 'append'); await fs.mkdir(appendRoot);
  const writeFailure = new Error('original scheduled spill failed');
  let scheduled = 0;
  const collector = createRowSpillCollector({ outDir: appendRoot, runPrefix: 'failed', maxBufferRows: 1,
    compare: compareChargramRows, scheduleIo(fn) { if (++scheduled === 2) throw writeFailure; return fn(); } });
  await assert.rejects(collector.append({ token: 'a', postings: [1] }), error => error === writeFailure);
  await collector.cleanup();
  assert.equal(scheduled, 3, 'one failed write plus independent cleanup, without a finalize-to-clean retry');
  assert.deepEqual(await fs.readdir(appendRoot), []);

  const mergeRoot = path.join(dir, 'merge-failure'); await fs.mkdir(mergeRoot);
  const helpers = createSpillHelpers({ buildRoot: mergeRoot });
  const teardownFailure = new Error('original merge teardown failed');
  let closed = false, cleaned = false;
  await assert.rejects(buildPhraseAndChargramPostings({ ...options(mergeRoot, source()),
    async mergeSpillRuns(input) {
      const actual = await helpers.mergeSpillRuns(input);
      return { ...actual,
        iterator: (async function* () {
          try { for await (const row of actual.iterator) { yield row; throw 0; } }
          finally { closed = true; }
        })(),
        async cleanup() { cleaned = true; await actual.cleanup?.(); throw teardownFailure; }
      };
    } }), error => error instanceof AggregateError && error.cause === 0
      && error.errors[0] === 0 && error.errors[1] === teardownFailure);
  assert.equal(closed, true); assert.equal(cleaned, true);
  assert.deepEqual(await fs.readdir(mergeRoot), [], 'merge teardown failure cannot strand original input runs');

  // Real planner failure after one completed intermediate group retains input
  // runs, while its separate private output directory is cleaned by its owner.
  const plannerRoot = path.join(dir, 'planner'); await fs.mkdir(plannerRoot);
  const inputs = path.join(plannerRoot, 'inputs'); await fs.mkdir(inputs);
  const runs = [];
  for (let i = 0; i <= DEFAULT_MAX_OPEN_RUNS; i++) {
    const run = path.join(inputs, `${i}.jsonl`); runs.push(run);
    if (i === DEFAULT_MAX_OPEN_RUNS) await fs.writeFile(run, 'invalid JSON\n');
    else await writeJsonlRunFile(run, [{ token: String(i).padStart(3, '0'), postings: [i], order: i }]);
  }
  await assert.rejects(createSpillHelpers({ buildRoot: plannerRoot }).mergeSpillRuns({
    runs, compare: compareChargramRows, label: 'phrase_postings'
  }), /Invalid JSONL/);
  assert.deepEqual(await fs.readdir(plannerRoot), ['inputs']);
  assert.equal((await fs.readdir(inputs)).length, runs.length, 'planner cleanup owns outputs, never borrowed source runs');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('hashed phrase errors and cancellation retain original source/collector/planner cleanup ownership');
