import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const [shape, representation, trigger] = String(selected).split('-');
assert.ok(['collision', 'unique'].includes(shape)); assert.ok(['hashed', 'legacy'].includes(representation));
assert.ok(['none', 'bytes', 'unique'].includes(trigger));
const { dir } = await prepareIsolatedTestCacheDir('phrase-resource-' + selected);
const spill = new URL('../../../src/index/build/postings/spill.js', import.meta.url).href;
const merge = new URL('../../../src/shared/merge.js', import.meta.url).href;
const calls = []; globalThis.phraseResourceMerge = calls;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === spill && specifier === '../../../shared/merge.js') return { url: 'phrase-resource:merge', shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'phrase-resource:merge') return { format: 'module', shortCircuit: true, source: `
    export * from ${JSON.stringify(merge)};
    import fs from 'node:fs';import {mergeSortedRuns as real} from ${JSON.stringify(merge)};
    export const mergeSortedRuns=(runs,options)=>{
      const input=runs.map(run=>typeof run==='string'?run:run.path);
      globalThis.phraseResourceMerge.push({runs:input.length,bytes:input.reduce((total,file)=>total+fs.statSync(file).size,0)});
      return real(runs,options);
    };` };
  return next(url, context);
} });
const count = 12001, tokenIdMap = new Map([['anchor', 'anchor']]), phrasePost = new Map(), phrasePostHashBuckets = new Map();
let collision = [], expectedVocab = [], expectedPostings = [];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
for (let id = 0; id < count; id++) {
  expectedVocab.push(`term-${String(id).padStart(5, '0')}-雪😀\u0001anchor`);
  expectedPostings.push([...new Set([id % 7, (id + 1) % 7])].sort((a, b) => a - b));
}
for (let id = count - 1; id >= 0; id--) {
  const key = `id-${id}`; tokenIdMap.set(key, `term-${String(id).padStart(5, '0')}-雪😀`);
  const posting = [id % 7, id % 7, (id + 1) % 7];
  if (representation === 'legacy') phrasePost.set(expectedVocab[id], posting);
  else {
    const entry = { ids: [key, 'anchor'], posting };
    if (shape === 'collision') collision.push(entry); else phrasePostHashBuckets.set(id, { kind: 'single', ...entry });
  }
}
if (representation === 'hashed' && shape === 'collision') phrasePostHashBuckets.set('forced-collision', { kind: 'collision', entries: collision });
collision = null;
const expectedDigest = digest([expectedVocab, expectedPostings]); expectedVocab = null; expectedPostings = null;
const { buildPostings } = await import('../../../src/index/build/postings.js');
const memoryAtInput = process.memoryUsage(), observed = { rss: memoryAtInput.rss, heapUsed: memoryAtInput.heapUsed };
const sampleMemory = () => { const usage = process.memoryUsage(); observed.rss = Math.max(observed.rss, usage.rss);
  observed.heapUsed = Math.max(observed.heapUsed, usage.heapUsed); };
const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable();
const timer = setInterval(sampleMemory, 10), started = performance.now(), cpu = process.cpuUsage();
try {
  const result = await buildPostings({ tokenIdMap, phrasePost, phrasePostHashBuckets,
    chunks: [{ tokens: ['anchor'], tokenCount: 1 }], tokenPostings: new Map(), docLengths: [1],
    postingsConfig: { enableChargrams: false, fielded: false, ...(representation === 'legacy' ? { phraseHash: false } : {}),
      phraseSpillMaxUnique: trigger === 'unique' ? 4000 : 0, phraseSpillMaxBytes: trigger === 'bytes' ? 1 : 0 },
    buildRoot: dir, embeddingsEnabled: false });
  const elapsedMs = performance.now() - started, usedCpu = process.cpuUsage(cpu); sampleMemory(); clearInterval(timer); histogram.disable();
  assert.equal(digest([result.phraseVocab, result.phrasePostings]), expectedDigest);
  const stats = result.phraseStats;
  assert.equal(stats.inputRows, count); assert.equal(stats.finalRows, count);
  assert.equal(phrasePost.size, 0); assert.equal(phrasePostHashBuckets.size, 0);
  if (trigger === 'none') { assert.equal(stats.spillRuns, 0); assert.equal(calls.length, 0); }
  else {
    assert.equal(stats.spillRuns, 3); assert.equal(calls.length, 1); assert.equal(calls[0].runs, stats.spillRuns);
    assert.equal(calls[0].bytes, stats.spillBytes, 'closed real run bytes agree with producer telemetry');
    assert.ok(stats.collectorBufferHighWaterRows <= stats.collectorMaxRows);
    assert.ok(stats.collectorBufferHighWaterBytes < stats.collectorMaxBytes + stats.maxRowBytes);
  }
  assert.deepEqual(await fs.readdir(dir), []);
  console.log(JSON.stringify({ kind: 'serial-phrase-resource-sample', case: selected, pid: process.pid, rows: count, elapsedMs,
    cpu: usedCpu, memoryAtInput, memoryAfterBuild: process.memoryUsage(), peakObserved: observed,
    processLifetimeMaxRssKiB: process.resourceUsage().maxRSS,
    memoryScope: 'input/final arrays still materialize; sampled heap/RSS peaks are observations, process RSS maximum includes startup',
    eventLoopDelay: histogram.count ? { count: histogram.count, meanNs: histogram.mean, maxNs: histogram.max, p99Ns: histogram.percentile(99) } : null,
    digest: digest([result.phraseVocab, result.phrasePostings]), actualMerge: calls, stats }));
} finally { clearInterval(timer); histogram.disable(); hook.deregister(); delete globalThis.phraseResourceMerge;
  await fs.rm(dir, { recursive: true, force: true }); }
