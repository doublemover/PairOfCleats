import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BENCH_MEASUREMENT_SNAPSHOT_VERSION } from '../../tools/bench/language/metrics/recorded-evidence.js';

/** Actual immutable-reference envelope for the existing saved-report reader.
 * The caller owns the disposable fixture directory and passes it as sourceRoot.
 */
export const writeRecordedFeatureSnapshot = async (directory, featureMetrics, { attemptId = 'fixture-attempt', relativePath = 'measurements.json' } = {}) => {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: BENCH_MEASUREMENT_SNAPSHOT_VERSION, attemptId, featureMetrics }));
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, relativePath), bytes);
  return { run: { attemptId }, artifacts: { measurementSnapshot: { schemaVersion: BENCH_MEASUREMENT_SNAPSHOT_VERSION,
    attemptId, path: relativePath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
};
