import os from 'node:os';

const ARTIFACT_WRITE_CONCURRENCY_MIN = 1;
const ARTIFACT_WRITE_CONCURRENCY_MAX = 64;
const ARTIFACT_WRITE_DEFAULT_MAX = 16;
const ARTIFACT_WRITE_HIGH_VOLUME_THRESHOLD = 64;
const ARTIFACT_WRITE_HIGH_VOLUME_DEFAULT_MAX = 48;

/**
 * Resolve artifact writer concurrency with a dynamic default and bounded override.
 *
 * Defaults are intentionally tiered:
 * - standard builds: up to 16 concurrent writes
 * - high-volume builds (many artifact files): up to 48 concurrent writes
 *
 * Explicit `indexing.artifacts.writeConcurrency` config always wins, and
 * `availableParallelism` is exposed for deterministic tests.
 *
 * @param {{artifactConfig?:object,totalWrites:number,availableParallelism?:number|null}} input
 * @returns {{cap:number,override:boolean}}
 */
export const resolveArtifactWriteConcurrency = ({
  artifactConfig,
  totalWrites,
  availableParallelism = null
}) => {
  const resolvedWrites = Number.isFinite(Number(totalWrites))
    ? Math.max(0, Math.floor(Number(totalWrites)))
    : 0;
  if (!resolvedWrites) return { cap: 0, override: false };
  const configured = artifactConfig?.writeConcurrency;
  if (configured != null) {
    const parsed = Number(configured);
    const isInt = Number.isInteger(parsed);
    if (!isInt || parsed < ARTIFACT_WRITE_CONCURRENCY_MIN || parsed > ARTIFACT_WRITE_CONCURRENCY_MAX) {
      const err = new Error(
        '[config] indexing.artifacts.writeConcurrency must be an integer in range 1..64.'
      );
      err.code = 'ERR_CONFIG_ARTIFACT_WRITE_CONCURRENCY';
      throw err;
    }
    return { cap: parsed, override: true };
  }
  const available = Number.isFinite(Number(availableParallelism)) && Number(availableParallelism) > 0
    ? Number(availableParallelism)
    : (typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length);
  const baseline = Number.isFinite(Number(available))
    ? Math.max(1, Math.floor(Number(available)))
    : 1;
  const defaultCap = resolvedWrites >= ARTIFACT_WRITE_HIGH_VOLUME_THRESHOLD
    ? ARTIFACT_WRITE_HIGH_VOLUME_DEFAULT_MAX
    : ARTIFACT_WRITE_DEFAULT_MAX;
  return {
    cap: Math.max(
      ARTIFACT_WRITE_CONCURRENCY_MIN,
      Math.min(defaultCap, baseline)
    ),
    override: false
  };
};
