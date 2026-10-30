import { createHash } from 'node:crypto';

export const CACHE_MEASUREMENT_SHAPE = Object.freeze({ sources: 32, declarations: 512, repetitions: 3,
  workerCounts: Object.freeze([1, 2]), queryModes: Object.freeze([false, true]) });
export const cacheMeasurementCorpus = () => {
  const body = Array.from({ length: CACHE_MEASUREMENT_SHAPE.declarations }, (_, index) =>
    `function measured${String(index).padStart(4, '0')}(value) { return value + ${index}; }`).join('\n') + '\n';
  return Array.from({ length: CACHE_MEASUREMENT_SHAPE.sources }, (_, index) => {
    const text = body + '// cache source ' + String(index).padStart(2, '0') + '\n';
    return { text, sourceHash: createHash('sha256').update(text).digest('hex') };
  });
};
export const summarizeCacheSamples = values => {
  if (!Array.isArray(values) || values.length !== CACHE_MEASUREMENT_SHAPE.sources
    || values.some(value => !Number.isFinite(value) || value < 0)) throw new TypeError('Complete32 actual duration samples required.');
  const ordered = values.toSorted((a, b) => a - b);
  return { count: values.length, minMs: ordered[0], medianMs: (ordered[15] + ordered[16]) / 2,
    p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1], maxMs: ordered.at(-1), totalMs: values.reduce((sum, value) => sum + value, 0) };
};
