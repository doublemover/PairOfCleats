import { createHash } from 'node:crypto';
import { assertSampledBenchAccounting, normalizeSampledBenchOptions, runSampledBench } from './utils.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const bytes = value => {
  if (!(value instanceof Uint8Array)) fail('ERR_BENCH_COMPRESSION_OUTPUT', 'Codec output must be bytes.');
  return Buffer.from(value);
};
const payloadSeed = 0x706f6331;
export const buildCompressionPayload = (size, entropy) => {
  if (!Number.isSafeInteger(size) || size < 1 || !Number.isFinite(entropy) || entropy < 0 || entropy > 1) {
    throw new RangeError('Compression payload requires a positive integral size and entropy in [0,1].');
  }
  let state = (payloadSeed ^ size) >>> 0;
  const draw = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const payload = Buffer.alloc(size);
  for (let index = 0; index < size; index++) payload[index] = entropy === 0 ? 0x61
    : draw() < entropy ? Math.floor(draw() * 256) : 0x61 + index % 26;
  return payload;
};

/** Synthetic paired inputs only; correctness admission is outside codec timing.
 * Backend and clock controls are internal fixtures, not CLI backend substitutes. */
export const runCompressionBenchmark = async ({ sizes, entropy, iterations, samples, warmup, backends },
  { sample = runSampledBench } = {}) => {
  normalizeSampledBenchOptions({ iterations, samples, warmup });
  if (!Array.isArray(sizes) || !sizes.length || new Set(sizes).size !== sizes.length
    || !Array.isArray(backends) || !backends.length || new Set(backends.map(value => value.label)).size !== backends.length
    || backends.some(value => typeof value.label !== 'string' || !value.label
      || typeof value.compress !== 'function' || typeof value.decompress !== 'function')) throw new TypeError('Distinct compression sizes and codec arms are required.');
  const workloads = sizes.map(size => {
    const payload = buildCompressionPayload(size, entropy);
    return { size, payload, identity: { algorithm: 'sha256', hash: digest(payload), bytes: payload.length,
      generator: 'lcg32-text-mixture-v1', seed: payloadSeed, entropy, family: 'synthetic-compressibility' } };
  });
  const arms = [];
  // Every arm must qualify before any successful timing report is assembled.
  for (let index = 0; index < workloads.length; index++) {
    const workload = workloads[index];
    for (const backend of index % 2 ? backends.toReversed() : backends) {
      const payload = Buffer.from(workload.payload), compressed = bytes(await backend.compress(payload));
      if (digest(payload) !== workload.identity.hash) fail('ERR_BENCH_COMPRESSION_MUTATION', 'Codec mutated its paired payload.');
      const compressedHash = digest(compressed);
      const decoded = bytes(await backend.decompress(compressed));
      if (!decoded.equals(payload)) fail('ERR_BENCH_COMPRESSION_ROUNDTRIP', 'Codec preflight failed byte-identical round trip.');
      if (digest(compressed) !== compressedHash) fail('ERR_BENCH_COMPRESSION_MUTATION', 'Decoder mutated its compressed input.');
      arms.push({ workload, backend, payload, compressed, compressedHash });
    }
  }
  const report = { schemaVersion: 2, kind: 'paired-compression-microbenchmark', generatedAt: new Date().toISOString(),
    sizes, iterations, requestedSamples: samples, warmup, entropy, workloads: workloads.map(value => value.identity),
    armOrder: arms.map(arm => ({ size: arm.workload.size, backend: arm.backend.label })),
    orderPolicy: 'alternate-backend-order-between-sizes', qualification: 'synthetic-codec-work-only',
    runtime: { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch }, backends: Object.create(null) };
  for (const { workload, backend, payload, compressed, compressedHash } of arms) {
    let lastCompressed, lastDecoded;
    const options = { iterations, samples, warmup };
    const compress = assertSampledBenchAccounting(await sample(async () => {
      lastCompressed = await backend.compress(payload);
    }, options), options);
    const decompress = assertSampledBenchAccounting(await sample(async () => {
      lastDecoded = await backend.decompress(compressed);
    }, options), options);
    if (digest(payload) !== workload.identity.hash || digest(compressed) !== compressedHash) {
      fail('ERR_BENCH_COMPRESSION_MUTATION', 'Timed codec operations mutated admitted input bytes.');
    }
    if (!bytes(lastDecoded).equals(payload) || !bytes(await backend.decompress(bytes(lastCompressed))).equals(payload)) {
      fail('ERR_BENCH_COMPRESSION_ROUNDTRIP', 'Codec postflight failed byte-identical round trip.');
    }
    // Postflight is deliberately separate from the measured operation counts.
    if (digest(payload) !== workload.identity.hash || digest(compressed) !== compressedHash) {
      fail('ERR_BENCH_COMPRESSION_MUTATION', 'Codec postflight mutated admitted input bytes.');
    }
    report.backends[backend.label] ||= {};
    report.backends[backend.label][String(workload.size)] = { available: true, payloadBytes: payload.length,
      compressedBytes: compressed.length, ratio: compressed.length / payload.length, inputIdentity: workload.identity,
      implementation: backend.implementation || { name: backend.label, version: null, settings: 'unobserved' },
      roundTrip: 'byte-identical-preflight-and-postflight', verificationOperations: { compress: 1, decompress: 2 }, compress, decompress };
  }
  return report;
};
