import os from 'node:os';

const PLANNER_IO_CONCURRENCY_CAP = 32;
const PLANNER_IO_LARGE_REPO_THRESHOLD = 20000;
const TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT = 3;

export const resolvePlannerIoConcurrency = (treeSitterConfig, entryCount = 0) => {
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const configuredRaw = Number(
    schedulerConfig.planIoConcurrency
      ?? schedulerConfig.plannerIoConcurrency
      ?? schedulerConfig.ioConcurrency
  );
  if (Number.isFinite(configuredRaw) && configuredRaw > 0) {
    return Math.max(1, Math.min(PLANNER_IO_CONCURRENCY_CAP, Math.floor(configuredRaw)));
  }
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : 4;
  const totalMemGb = Number.isFinite(Number(os.totalmem()))
    ? (Number(os.totalmem()) / (1024 ** 3))
    : null;
  const memoryConstrainedCap = Number.isFinite(totalMemGb) && totalMemGb > 0 && totalMemGb < 8
    ? 8
    : PLANNER_IO_CONCURRENCY_CAP;
  let resolved = Math.max(1, Math.min(memoryConstrainedCap, Math.floor(available || 1)));
  if (Number(entryCount) >= PLANNER_IO_LARGE_REPO_THRESHOLD) {
    const boosted = Math.max(resolved, Math.floor((available || 1) * 0.75));
    resolved = Math.max(1, Math.min(memoryConstrainedCap, boosted));
  }
  return resolved;
};

export const createSkipLogger = ({ treeSitterConfig, log }) => {
  const schedulerConfig = treeSitterConfig?.scheduler || {};
  const sampleLimitRaw = Number(
    schedulerConfig.skipLogSampleLimit
      ?? schedulerConfig.logSkipSampleLimit
      ?? schedulerConfig.skipSampleLimit
      ?? TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT
  );
  const sampleLimit = Number.isFinite(sampleLimitRaw) && sampleLimitRaw >= 0
    ? Math.floor(sampleLimitRaw)
    : TREE_SITTER_SKIP_SAMPLE_LIMIT_DEFAULT;
  const emitSamples = schedulerConfig.logSkips !== false;
  const counts = new Map();
  const sampleCounts = new Map();

  const record = (reason, message) => {
    const reasonKey = reason || 'unknown';
    counts.set(reasonKey, (counts.get(reasonKey) || 0) + 1);
    if (!emitSamples || !log || sampleLimit <= 0 || !message) return;
    const seen = sampleCounts.get(reasonKey) || 0;
    if (seen >= sampleLimit) return;
    sampleCounts.set(reasonKey, seen + 1);
    const text = typeof message === 'function' ? message() : message;
    if (text) log(text);
  };

  const flush = () => {
    if (!log || !counts.size) return;
    const summaryLines = Array.from(counts.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([reason, count]) => {
        const sampled = sampleCounts.get(reason) || 0;
        const suppressed = Math.max(0, count - sampled);
        return `[tree-sitter:schedule] skip summary ${reason}: ${count} total (${sampled} sampled, ${suppressed} suppressed)`;
      });
    for (const line of summaryLines) log(line);
  };

  return { record, flush };
};
