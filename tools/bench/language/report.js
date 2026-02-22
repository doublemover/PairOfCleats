import { log } from '../../../src/shared/progress.js';
import {
  STAGE_TIMING_SCHEMA_VERSION,
  buildStageTimingProfileForTask,
  createEmptyStageTimingProfile,
  finalizeStageTimingProfile,
  mergeStageTimingProfile
} from './metrics.js';

const resolveCrashRetention = (entry) => {
  const direct = entry?.crashRetention && typeof entry.crashRetention === 'object'
    ? entry.crashRetention
    : null;
  if (direct) return direct;
  const nested = entry?.diagnostics?.crashRetention && typeof entry.diagnostics.crashRetention === 'object'
    ? entry.diagnostics.crashRetention
    : null;
  return nested;
};

const buildCrashRetentionSummary = (results) => {
  const retained = [];
  for (const entry of Array.isArray(results) ? results : []) {
    const crashRetention = resolveCrashRetention(entry);
    if (!crashRetention?.bundlePath) continue;
    retained.push({
      language: entry.language,
      tier: entry.tier,
      repo: entry.repo,
      bundlePath: crashRetention.bundlePath,
      markerPath: crashRetention.markerPath || null,
      diagnosticsDir: crashRetention.diagnosticsDir || null,
      checksum: crashRetention.checksum || null
    });
  }
  return {
    retainedCount: retained.length,
    retained
  };
};

export const summarizeResults = (items) => {
  const valid = items.filter((entry) => entry.summary);
  if (!valid.length) return null;
  const backendSet = new Set();
  for (const entry of valid) {
    const summary = entry.summary;
    const backends = summary.backends || Object.keys(summary.latencyMsAvg || {});
    for (const backend of backends) backendSet.add(backend);
  }
  const backends = Array.from(backendSet);
  const latencyMsAvg = {};
  const hitRate = {};
  const resultCountAvg = {};
  const memoryRssAvgMb = {};
  const buildMsAvg = {};
  for (const backend of backends) {
    const latencies = valid.map((entry) => entry.summary?.latencyMsAvg?.[backend]).filter(Number.isFinite);
    const hits = valid.map((entry) => entry.summary?.hitRate?.[backend]).filter(Number.isFinite);
    const results = valid.map((entry) => entry.summary?.resultCountAvg?.[backend]).filter(Number.isFinite);
    const mem = valid
      .map((entry) => entry.summary?.memoryRss?.[backend]?.mean)
      .filter(Number.isFinite)
      .map((value) => value / (1024 * 1024));
    if (latencies.length) latencyMsAvg[backend] = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    if (hits.length) hitRate[backend] = hits.reduce((a, b) => a + b, 0) / hits.length;
    if (results.length) resultCountAvg[backend] = results.reduce((a, b) => a + b, 0) / results.length;
    if (mem.length) memoryRssAvgMb[backend] = mem.reduce((a, b) => a + b, 0) / mem.length;
  }
  for (const entry of valid) {
    const build = entry.summary?.buildMs;
    if (!build) continue;
    for (const [key, value] of Object.entries(build)) {
      if (!Number.isFinite(value)) continue;
      if (!buildMsAvg[key]) buildMsAvg[key] = [];
      buildMsAvg[key].push(value);
    }
  }
  const buildMs = Object.fromEntries(
    Object.entries(buildMsAvg).map(([key, values]) => [
      key,
      values.reduce((a, b) => a + b, 0) / values.length
    ])
  );
  const stageTimingMerged = createEmptyStageTimingProfile();
  let stageTimingSamples = 0;
  for (const entry of valid) {
    if (!entry?.stageTimingProfile) continue;
    mergeStageTimingProfile(stageTimingMerged, entry.stageTimingProfile);
    stageTimingSamples += 1;
  }
  const stageTiming = stageTimingSamples > 0
    ? finalizeStageTimingProfile(stageTimingMerged)
    : null;
  return {
    backends,
    latencyMsAvg,
    hitRate,
    resultCountAvg,
    memoryRssAvgMb,
    buildMs: Object.keys(buildMs).length ? buildMs : null,
    stageTiming
  };
};

export const printSummary = (
  label,
  summary,
  count,
  quietMode,
  { writeLine = (line) => log(line) } = {}
) => {
  if (!summary || quietMode) return;
  writeLine(`\n${label} summary (${count} repos)`);
  for (const backend of summary.backends) {
    const latency = summary.latencyMsAvg?.[backend];
    const hit = summary.hitRate?.[backend];
    const results = summary.resultCountAvg?.[backend];
    const mem = summary.memoryRssAvgMb?.[backend];
    const latencyText = Number.isFinite(latency) ? `${latency.toFixed(1)}ms` : 'n/a';
    const hitText = Number.isFinite(hit) ? `${(hit * 100).toFixed(1)}%` : 'n/a';
    const resultText = Number.isFinite(results) ? results.toFixed(1) : 'n/a';
    const memText = Number.isFinite(mem) ? `${mem.toFixed(1)} MB` : 'n/a';
    writeLine(`- ${backend} avg ${latencyText} | hit ${hitText} | avg hits ${resultText} | rss ${memText}`);
  }
  if (summary.buildMs) {
    for (const [key, value] of Object.entries(summary.buildMs)) {
      if (!Number.isFinite(value)) continue;
      writeLine(`- build ${key} avg ${(value / 1000).toFixed(1)}s`);
    }
  }
};

export const buildReportOutput = ({ configPath, cacheRoot, resultsRoot, results, config }) => {
  const tasks = results.map((entry) => ({
    ...entry,
    stageTimingProfile: entry?.summary
      ? buildStageTimingProfileForTask({
        repoPath: entry.repoPath,
        summary: entry.summary
      })
      : null
  }));
  const groupedResults = new Map();
  for (const entry of tasks) {
    if (!groupedResults.has(entry.language)) groupedResults.set(entry.language, []);
    groupedResults.get(entry.language).push(entry);
  }
  const groupedSummary = {};
  for (const [language, items] of groupedResults.entries()) {
    groupedSummary[language] = {
      label: config[language]?.label || language,
      count: items.length,
      summary: summarizeResults(items)
    };
  }
  const overallSummary = summarizeResults(tasks);
  const crashRetention = buildCrashRetentionSummary(tasks);
  const stageTimingTasks = tasks
    .filter((entry) => entry?.stageTimingProfile)
    .map((entry) => ({
      language: entry.language,
      tier: entry.tier,
      repo: entry.repo,
      repoPath: entry.repoPath || null,
      outFile: entry.outFile || null,
      stageTiming: entry.stageTimingProfile
    }));
  const stageTimingGrouped = Object.fromEntries(
    Object.entries(groupedSummary)
      .map(([language, payload]) => [language, payload?.summary?.stageTiming || null])
  );
  return {
    generatedAt: new Date().toISOString(),
    config: configPath,
    cacheRoot,
    resultsRoot,
    tasks,
    diagnostics: {
      crashRetention
    },
    stageTiming: {
      schemaVersion: STAGE_TIMING_SCHEMA_VERSION,
      tasks: stageTimingTasks,
      grouped: stageTimingGrouped,
      overall: overallSummary?.stageTiming || null
    },
    groupedSummary,
    overallSummary
  };
};
