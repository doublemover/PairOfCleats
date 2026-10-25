import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createSafeRegex } from '../../../src/shared/safe-regex.js';
import { tryRequire } from '../../../src/shared/optional-deps.js';
import { runSampledBench } from './utils.js';

const require = createRequire(import.meta.url);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const count = (value, minimum, name) => {
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.floor(value))) throw new RangeError(`Invalid regex benchmark ${name}.`);
  return Math.max(minimum, Math.floor(value));
};
const installedPackage = name => {
  try {
    let directory = path.dirname(require.resolve(name));
    for (let depth = 0; depth < 12; depth++) {
      try {
        const metadata = require(path.join(directory, 'package.json'));
        if (metadata.name === name) return { name, version: typeof metadata.version === 'string' ? metadata.version : null };
      } catch { /* Entry subdirectories need not contain package metadata. */ }
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
  } catch { /* Availability is reported independently of package-version evidence. */ }
  return { name, version: null };
};
const nativeAvailability = () => {
  const result = tryRequire('re2');
  const available = result.ok && typeof (result.mod?.default ?? result.mod) === 'function';
  return { available, reason: available ? null : result.ok ? 'not-a-constructor' : result.reason };
};
const matchingWitness = (regex, input) => {
  regex.lastIndex = 0;
  const match = regex.exec(input);
  const value = match ? { index: match.index, groups: Array.from(match, value => value ?? null) } : null;
  return { matched: match !== null, digest: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
};

/** Compare the same production wrapper and offset-zero operation on each
 * explicitly selected engine. Dependency seams are private fixture controls. */
export const runRegexBenchmark = async ({ pattern, flags = '', input, iterations = 50000, samples = 10, warmup = 2000 },
  { compile = createSafeRegex, native = nativeAvailability, packageIdentity = installedPackage, sample = runSampledBench } = {}) => {
  if (typeof pattern !== 'string' || !pattern || typeof input !== 'string' || !input
    || typeof flags !== 'string' || /[^gims]/.test(flags)) throw new TypeError('Regex benchmark requires a pattern, nonempty input and supported g/i/m/s flags.');
  iterations = count(iterations, 1, 'iterations'); samples = Math.min(iterations, count(samples, 1, 'samples')); warmup = count(warmup, 0, 'warmup');
  if (!Number.isSafeInteger(iterations + warmup)) throw new RangeError('Regex operation count exceeds exact integer accounting.');
  const effectiveFlags = ['g', 'i', 'm', 's'].filter(flag => flags.includes(flag)).join('');
  const availability = native();
  const engines = {}, arms = [];
  for (const name of ['re2js', 're2']) {
    if (name === 're2' && availability.available !== true) {
      engines.re2 = { available: false, requestedEngine: 're2', effectiveEngine: null,
        reason: availability.reason || 'unavailable', package: packageIdentity(name) }; continue;
    }
    const regex = compile(pattern, effectiveFlags, { engine: name, maxPatternLength: 0, maxInputLength: 0, maxProgramSize: 0, timeoutMs: 0 });
    if (!regex) fail('ERR_BENCH_REGEX_COMPILE', `Failed to compile requested ${name} pattern.`);
    if (regex.engine !== name || regex.flags !== effectiveFlags) fail('ERR_BENCH_REGEX_ENGINE', `Requested ${name}/${effectiveFlags}; observed ${regex.engine}/${regex.flags}.`);
    const first = matchingWitness(regex, input), repeated = matchingWitness(regex, input);
    if (first.digest !== repeated.digest) fail('ERR_BENCH_REGEX_PARITY', `${name} did not repeat its offset-zero matching result.`);
    if (arms.length && first.digest !== arms[0].witness.digest) fail('ERR_BENCH_REGEX_PARITY', 'Selected regex engines disagree on the matching result.');
    arms.push({ name, regex, witness: first, package: packageIdentity(name) });
  }
  // All compilation, effective identity and matching admission precedes timing.
  for (const arm of arms) {
    let calls = 0;
    const operation = () => { arm.regex.lastIndex = 0; calls++; return arm.regex.test(input); };
    const { totalMs, stats, timings } = await sample(operation, { iterations, samples, warmup });
    if (calls !== iterations + warmup) fail('ERR_BENCH_REGEX_WORK', 'Measured regex operation count differs from the declared work.');
    engines[arm.name] = { available: true, requestedEngine: arm.name, effectiveEngine: arm.regex.engine,
      package: arm.package, matching: arm.witness, measuredOperations: iterations, warmupOperations: warmup, samples,
      totalMs, opsPerSec: totalMs > 0 ? iterations / (totalMs / 1000) : null, stats, rawSampleDurationsMs: timings };
  }
  return { schemaVersion: 2, kind: 'regex-wrapper-benchmark', generatedAt: new Date().toISOString(),
    comparison: 'same-safe-regex-public-wrapper', operation: 'reset-lastIndex-to-zero-then-test',
    pattern, flags, effectiveFlags, inputBytes: Buffer.byteLength(input, 'utf8'),
    inputIdentity: { algorithm: 'sha256', encoding: 'utf16le-code-units',
      hash: createHash('sha256').update('regex-input-v1\0').update(input, 'utf16le').digest('hex') }, iterations, samples, warmup,
    runtime: { node: process.version, v8: process.versions.v8, abi: process.versions.modules, platform: process.platform, arch: process.arch }, engines };
};
