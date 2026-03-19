import fsPromises from 'node:fs/promises';

export const BENCH_RUN_DIFF_SCHEMA_VERSION = 1;

const toNumberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const average = (values) => {
  const list = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value)));
  if (!list.length) return null;
  return list.reduce((sum, value) => sum + Number(value), 0) / list.length;
};

const countByDiagnosticType = (entry, type) => {
  const direct = Number(entry?.diagnostics?.process?.countsByType?.[type]);
  if (Number.isFinite(direct)) return direct;
  const nested = Number(entry?.diagnostics?.countsByType?.[type]);
  return Number.isFinite(nested) ? nested : 0;
};

const summarizeTask = (entry) => {
  const hitRates = Object.values(entry?.summary?.hitRate || {});
  return {
    buildIndexMs: toNumberOrNull(entry?.summary?.buildMs?.index),
    crashCount: entry?.taskStatus?.resultClass === 'crashed' ? 1 : 0,
    timeoutCount: entry?.taskStatus?.resultClass === 'timed_out' ? 1 : 0,
    degradationCount: Array.isArray(entry?.taskStatus?.degradationClasses)
      ? entry.taskStatus.degradationClasses.length
      : 0,
    artifactTailStallCount: countByDiagnosticType(entry, 'artifact_tail_stall'),
    cacheHitRate: average(hitRates)
  };
};

const buildTaskKey = (entry) => [
  String(entry?.language || 'unknown'),
  String(entry?.tier || 'unknown'),
  String(entry?.repo || 'unknown')
].join(':');

const buildTaskMap = (report) => {
  const out = new Map();
  for (const entry of Array.isArray(report?.tasks) ? report.tasks : []) {
    out.set(buildTaskKey(entry), entry);
  }
  return out;
};

const buildAggregateDelta = (beforeValue, afterValue) => {
  const before = toNumberOrNull(beforeValue);
  const after = toNumberOrNull(afterValue);
  if (before == null && after == null) return null;
  const delta = before != null && after != null
    ? Number((after - before).toFixed(6))
    : null;
  return {
    before,
    after,
    delta
  };
};

const summarizeLanguageGroup = (tasks) => {
  const rows = (Array.isArray(tasks) ? tasks : []).map((entry) => summarizeTask(entry));
  return {
    repoCount: rows.length,
    buildIndexMs: average(rows.map((row) => row.buildIndexMs)),
    crashCount: rows.reduce((sum, row) => sum + row.crashCount, 0),
    timeoutCount: rows.reduce((sum, row) => sum + row.timeoutCount, 0),
    degradationCount: rows.reduce((sum, row) => sum + row.degradationCount, 0),
    artifactTailStallCount: rows.reduce((sum, row) => sum + row.artifactTailStallCount, 0),
    cacheHitRate: average(rows.map((row) => row.cacheHitRate))
  };
};

export const buildBenchRunDiff = ({ before, after }) => {
  const beforeTaskMap = buildTaskMap(before);
  const afterTaskMap = buildTaskMap(after);
  const taskKeys = Array.from(new Set([...beforeTaskMap.keys(), ...afterTaskMap.keys()])).sort();
  const byRepo = taskKeys.map((key) => {
    const beforeEntry = beforeTaskMap.get(key) || null;
    const afterEntry = afterTaskMap.get(key) || null;
    const beforeSummary = summarizeTask(beforeEntry);
    const afterSummary = summarizeTask(afterEntry);
    return {
      taskKey: key,
      language: beforeEntry?.language || afterEntry?.language || null,
      tier: beforeEntry?.tier || afterEntry?.tier || null,
      repo: beforeEntry?.repo || afterEntry?.repo || null,
      buildIndexMs: buildAggregateDelta(beforeSummary.buildIndexMs, afterSummary.buildIndexMs),
      crashCount: buildAggregateDelta(beforeSummary.crashCount, afterSummary.crashCount),
      timeoutCount: buildAggregateDelta(beforeSummary.timeoutCount, afterSummary.timeoutCount),
      degradationCount: buildAggregateDelta(beforeSummary.degradationCount, afterSummary.degradationCount),
      artifactTailStallCount: buildAggregateDelta(beforeSummary.artifactTailStallCount, afterSummary.artifactTailStallCount),
      cacheHitRate: buildAggregateDelta(beforeSummary.cacheHitRate, afterSummary.cacheHitRate)
    };
  });

  const languageSet = new Set([
    ...Array.from(beforeTaskMap.values()).map((entry) => entry.language),
    ...Array.from(afterTaskMap.values()).map((entry) => entry.language)
  ]);
  const byLanguage = Array.from(languageSet)
    .filter(Boolean)
    .sort((left, right) => String(left).localeCompare(String(right)))
    .map((language) => {
      const beforeTasks = Array.from(beforeTaskMap.values()).filter((entry) => entry.language === language);
      const afterTasks = Array.from(afterTaskMap.values()).filter((entry) => entry.language === language);
      const beforeSummary = summarizeLanguageGroup(beforeTasks);
      const afterSummary = summarizeLanguageGroup(afterTasks);
      return {
        language,
        repoCount: buildAggregateDelta(beforeSummary.repoCount, afterSummary.repoCount),
        buildIndexMs: buildAggregateDelta(beforeSummary.buildIndexMs, afterSummary.buildIndexMs),
        crashCount: buildAggregateDelta(beforeSummary.crashCount, afterSummary.crashCount),
        timeoutCount: buildAggregateDelta(beforeSummary.timeoutCount, afterSummary.timeoutCount),
        degradationCount: buildAggregateDelta(beforeSummary.degradationCount, afterSummary.degradationCount),
        artifactTailStallCount: buildAggregateDelta(beforeSummary.artifactTailStallCount, afterSummary.artifactTailStallCount),
        cacheHitRate: buildAggregateDelta(beforeSummary.cacheHitRate, afterSummary.cacheHitRate)
      };
    });

  return {
    schemaVersion: BENCH_RUN_DIFF_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    before: {
      generatedAt: before?.generatedAt || null,
      methodology: before?.methodology || null
    },
    after: {
      generatedAt: after?.generatedAt || null,
      methodology: after?.methodology || null
    },
    byLanguage,
    byRepo
  };
};

export const loadBenchRunReport = async (filePath) => JSON.parse(await fsPromises.readFile(filePath, 'utf8'));
