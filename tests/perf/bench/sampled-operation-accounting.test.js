import assert from 'node:assert/strict';
import { runSampledBench, assertSampledBenchAccounting, summarizeDurations } from '../../../tools/bench/micro/utils.js';
import { runHashBenchmark } from '../../../tools/bench/micro/hash-runner.js';
import { runRegexBenchmark } from '../../../tools/bench/micro/regex-runner.js';
import { runSampled as runVfsSampled } from '../../../tools/bench/vfs/shared.js';

assert.deepEqual(summarizeDurations([0, 0, 0]), {
  count: 3, mean: 0, min: 0, max: 0, p50: 0.001, p95: 0.001, p99: 0.001
}, 'zero-duration work remains valid at the existing one-microsecond histogram resolution');

const sample = (operation, options) => {
  let time = 0n;
  return runSampledBench(operation, options, { nowNs: () => { const value = time; time += 1000000n; return value; } });
};
for (const [iterations, samples] of [[1, 10], [3, 10], [10, 10], [11, 10], [20, 4]]) {
  const indexes = [], vfs = runVfsSampled({ iterations, samples, fn: index => indexes.push(index) });
  assert.deepEqual(indexes, Array.from({ length: iterations }, (_, index) => index));
  assert.equal(vfs.completedOperations, iterations); assert.equal(vfs.effectiveSamples, Math.min(iterations, samples));
  assert.equal(vfs.bucketOperations.reduce((sum, value) => sum + value), iterations);
  assert.equal(vfs.opsPerSec, vfs.totalMs > 0 ? iterations / (vfs.totalMs / 1000) : 0);
  for (const kind of ['sync', 'async', 'mixed']) {
    let calls = 0;
    const operation = () => { calls++; return kind === 'async' || kind === 'mixed' && calls % 2 ? Promise.resolve(calls) : calls; };
    const options = { iterations, samples, warmup: 2 };
    const result = assertSampledBenchAccounting(await sample(operation, options), options);
    assert.equal(calls, iterations + 2); assert.equal(result.completedOperations, iterations);
    assert.equal(result.warmupOperations, 2); assert.equal(result.warmupMs, 1);
    assert.equal(result.requestedSamples, samples); assert.equal(result.effectiveSamples, Math.min(iterations, samples));
    assert.equal(result.bucketOperations.reduce((sum, value) => sum + value), iterations);
    assert.ok(result.bucketOperations.every(value => value >= 1));
    assert.ok(Math.max(...result.bucketOperations) - Math.min(...result.bucketOperations) <= 1);
    assert.equal(result.totalMs, result.effectiveSamples); assert.equal(result.statsUnit, 'milliseconds-per-bucket');
  }
  const hash = await runHashBenchmark({ hash64: () => 1n }, 'é', { iterations, samples, warmup: 0 }, { sample });
  assert.equal(hash.bytesProcessed, iterations * 2, 'byte throughput uses UTF-8 bytes and completed work');
  assert.equal(hash.mbPerSec, iterations * 2 / (1024 * 1024) / (Math.min(iterations, samples) / 1000));
  const regex = await runRegexBenchmark({ pattern: 'a', input: 'a', flags: '', iterations, samples, warmup: 0 }, {
    native: () => ({ available: false, reason: 'explicit-fixture-unavailable' }), packageIdentity: name => ({ name, version: 'fixture' }),
    compile: (pattern, flags, { engine }) => { const compiled = new RegExp(pattern, flags); return {
      engine, flags, lastIndex: 0, exec: input => compiled.exec(input), test: input => compiled.test(input)
    }; }, sample
  });
  assert.equal(regex.engines.re2js.measuredOperations, iterations);
  assert.equal(regex.engines.re2js.opsPerSec, iterations / (Math.min(iterations, samples) / 1000));
  assert.equal(regex.requestedSamples, samples);
}
for (const field of ['iterations', 'samples', 'warmup']) for (const invalid of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  await assert.rejects(runSampledBench(() => {}, { iterations: 2, samples: 1, warmup: 0, [field]: invalid }), RangeError);
}
for (const field of ['iterations', 'samples']) await assert.rejects(runSampledBench(() => {}, { iterations: 2, samples: 1, [field]: 0 }), RangeError);
const failure = new Error('measured operation failed'); let calls = 0;
let asyncVfsFailure;
assert.throws(() => runVfsSampled({ iterations: 1, samples: 10, fn: () => Promise.reject(failure) }), error => {
  asyncVfsFailure = error; assert.ok(error instanceof TypeError);
  assert.equal(error.cacheOwnershipPending, true); assert.equal(error.cacheOwnershipReleased(), false); return true;
});
await Promise.resolve(); assert.equal(asyncVfsFailure.cacheOwnershipReleased(), true);
assert.throws(() => runVfsSampled({ iterations: 1.5, samples: 1, fn: () => {} }), RangeError);
let mixedCalls = 0;
const mixed = await sample(() => ++mixedCalls % 2 ? mixedCalls : Promise.resolve(mixedCalls), { iterations: 11, samples: 4, warmup: 0 });
assert.equal(mixedCalls, 11); assert.equal(mixed.completedOperations, 11);
await assert.rejects(sample(() => { if (++calls === 2) throw failure; }, { iterations: 3, samples: 10, warmup: 0 }), error => error === failure);
assert.equal(calls, 2, 'a failed operation cannot publish a completed-work denominator');
await assert.rejects(runHashBenchmark({ hash64: () => 1n }, 'x', { iterations: 3, samples: 10, warmup: 0 }, {
  sample: async () => ({ completedOperations: 10 })
}), { code: 'ERR_BENCH_MEASURED_WORK' });
console.log('Synchronous and asynchronous sample buckets conserve actual work, separate warmup and drive hash/regex rates.');
