import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildCompressionPayload, runCompressionBenchmark } from '../../../tools/bench/micro/compression-runner.js';
import { runSampledBench } from '../../../tools/bench/micro/utils.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sample = (operation, options) => {
  let time = 0n;
  return runSampledBench(operation, options, { nowNs: () => { const value = time; time += 1000000n; return value; } });
};
const gzip = { label: 'gzip', compress: gzipSync, decompress: gunzipSync,
  implementation: { name: 'node:zlib/gzip', version: process.versions.zlib, settings: { level: -1 } } };
for (const entropy of [0, 0.25, 1]) {
  const observed = [], identity = { label: 'identity-fixture', implementation: { name: 'explicit-byte-copy-fixture', version: '1' },
    compress: bytes => { observed.push(digest(bytes)); return Buffer.from(bytes); }, decompress: bytes => Buffer.from(bytes) };
  const input = { sizes: [64, 257], entropy, iterations: 3, samples: 10, warmup: 1, backends: [gzip, identity] };
  const result = await runCompressionBenchmark(input, { sample });
  const repeated = await runCompressionBenchmark(input, { sample });
  assert.deepEqual(result.workloads, repeated.workloads);
  assert.deepEqual(result.armOrder, [{ size: 64, backend: 'gzip' }, { size: 64, backend: 'identity-fixture' },
    { size: 257, backend: 'identity-fixture' }, { size: 257, backend: 'gzip' }]);
  for (const size of input.sizes) {
    const one = result.backends.gzip[String(size)], two = result.backends['identity-fixture'][String(size)];
    assert.deepEqual(one.inputIdentity, two.inputIdentity); assert.equal(one.inputIdentity.hash, digest(buildCompressionPayload(size, entropy)));
    assert.ok(observed.includes(one.inputIdentity.hash));
    for (const arm of [one, two]) {
      assert.equal(arm.roundTrip, 'byte-identical-preflight-and-postflight');
      for (const phase of ['compress', 'decompress']) {
        assert.equal(arm[phase].completedOperations, 3); assert.equal(arm[phase].effectiveSamples, 3);
        assert.equal(arm[phase].requestedSamples, 10); assert.equal(arm[phase].warmupOperations, 1);
      }
    }
  }
  const absent = await runCompressionBenchmark({ ...input, backends: [gzip] }, { sample });
  assert.equal(Object.hasOwn(absent.backends, 'zstd'), false, 'unavailable codecs never acquire a substituted timing arm');
}
const input = { sizes: [64], entropy: 0, iterations: 2, samples: 10, warmup: 0 };
for (const mode of ['mutate', 'wrong', 'truncated', 'malformed', 'late-wrong', 'compressed-mutation']) {
  let calls = 0, timed = 0;
  const bad = { label: 'bad-fixture', compress: bytes => {
    calls++; if (mode === 'mutate') bytes[0] ^= 0xff;
    return Buffer.from(bytes);
  }, decompress: bytes => {
    if (mode === 'malformed') return 'not bytes';
    if (mode === 'compressed-mutation') bytes[0] ^= 0xff;
    if (mode === 'truncated') return bytes.subarray(1);
    if (mode === 'wrong' || mode === 'late-wrong' && calls > 1) return Buffer.alloc(bytes.length);
    return Buffer.from(bytes);
  } };
  await assert.rejects(runCompressionBenchmark({ ...input, backends: [bad] }, {
    sample: (...args) => { timed++; return sample(...args); }
  }), error => /^ERR_BENCH_COMPRESSION_/u.test(error.code));
  assert.equal(timed, mode === 'late-wrong' ? 2 : 0, 'invalid preflight never enters timed work');
}
assert.throws(() => buildCompressionPayload(1.5, 0), RangeError);
assert.throws(() => buildCompressionPayload(64, NaN), RangeError);
console.log('Compression arms share deterministic bytes, round-trip admission, mutation fences and completed-work receipts.');
