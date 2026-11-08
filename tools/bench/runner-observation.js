export const BENCH_OBSERVATION_VERSION = 1;
export const BENCH_SWEEP_KNOBS = Object.freeze(['writeConcurrency', 'cpuTokens', 'ioTokens', 'memTokens', 'bundleThreads', 'bundleSize', 'workerCounts']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const identity = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);

/** A producer declares actual completed work, correctness checks and consumed
 * settings. Merely forwarding environment values never proves application. */
export const admitBenchmarkObservation = value => {
  if (!object(value) || value.version !== BENCH_OBSERVATION_VERSION || !['fixture', 'benchmark'].includes(value.scope)) return { ok: false, reason: 'missing-or-invalid-observation' };
  const work = value.workload, correctness = value.correctness, durationMs = value.metrics?.durationMs;
  if (!object(work) || !text(work.id, 160) || !text(work.producerVersion, 128)
    || !Number.isSafeInteger(work.units) || work.units <= 0 || !identity(work.dataIdentity) || !identity(work.configurationIdentity)) {
    return { ok: false, reason: 'unqualified-workload-identity' };
  }
  if (correctness?.state !== 'passed' || !Array.isArray(correctness.checks) || !correctness.checks.length
    || correctness.checks.length > 64 || !correctness.checks.every(check => text(check, 128))) return { ok: false, reason: 'correctness-unqualified' };
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return { ok: false, reason: 'duration-unavailable' };
  if (!object(value.knobs)) return { ok: false, reason: 'knob-consumption-unqualified' };
  const knobs = {};
  for (const key of BENCH_SWEEP_KNOBS) {
    const entry = value.knobs[key];
    if (entry === undefined) continue;
    if (!object(entry) || !['applied', 'unsupported', 'unverified'].includes(entry.state)
      || entry.state === 'applied' && (typeof entry.value !== 'number' || !Number.isFinite(entry.value))) return { ok: false, reason: 'knob-consumption-invalid' };
    knobs[key] = { state: entry.state, ...(entry.state === 'applied' ? { value: entry.value } : {}) };
  }
  return { ok: true, observation: { version: BENCH_OBSERVATION_VERSION, scope: value.scope,
    workload: { id: work.id, producerVersion: work.producerVersion, units: work.units,
      dataIdentity: work.dataIdentity, configurationIdentity: work.configurationIdentity },
    correctness: { state: 'passed', checks: [...correctness.checks] }, metrics: { durationMs }, knobs } };
};
