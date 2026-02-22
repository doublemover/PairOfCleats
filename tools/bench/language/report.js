import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../../src/shared/progress.js';
import {
  STAGE_TIMING_SCHEMA_VERSION,
  buildStageTimingProfileForTask,
  createEmptyStageTimingProfile,
  finalizeStageTimingProfile,
  mergeStageTimingProfile
} from './metrics.js';
import {
  BENCH_DIAGNOSTIC_EVENT_TYPES,
  BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
  buildBenchDiagnosticEventId,
  buildBenchDiagnosticSignature,
  normalizeBenchDiagnosticText
} from './logging.js';

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

const DIAGNOSTIC_STREAM_FILE_SUFFIX = '.diagnostics.jsonl';

const listDiagnosticsStreamFiles = (resultsRoot) => {
  if (!resultsRoot) return [];
  const root = path.join(resultsRoot, 'logs', 'bench-language');
  if (!fs.existsSync(root)) return [];
  const files = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(resolved);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(DIAGNOSTIC_STREAM_FILE_SUFFIX)) {
        files.push(resolved);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
};

const parseDiagnosticEventLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const eventType = typeof parsed.eventType === 'string' ? parsed.eventType.trim() : '';
  const signature = typeof parsed.signature === 'string'
    ? parsed.signature
    : buildBenchDiagnosticSignature({
      eventType,
      stage: parsed.stage || '',
      taskId: parsed.taskId || '',
      source: parsed.source || '',
      message: normalizeBenchDiagnosticText(parsed.message || '', { maxLength: 220 })
    });
  const eventId = typeof parsed.eventId === 'string' && parsed.eventId.trim()
    ? parsed.eventId.trim()
    : buildBenchDiagnosticEventId({ eventType, signature });
  const message = typeof parsed.message === 'string' ? parsed.message : '';
  return {
    eventType,
    eventId,
    signature,
    message
  };
};

const buildDiagnosticsStreamSummary = (resultsRoot) => {
  const files = listDiagnosticsStreamFiles(resultsRoot);
  const countsByType = new Map();
  const uniqueEventIds = new Set();
  const knownTypes = new Set(BENCH_DIAGNOSTIC_EVENT_TYPES);
  const perFile = [];
  let eventCount = 0;
  let malformedLines = 0;

  for (const filePath of files) {
    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const fileCounts = new Map();
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (!line || !line.trim()) continue;
      const parsed = parseDiagnosticEventLine(line);
      if (!parsed) {
        malformedLines += 1;
        continue;
      }
      if (!parsed.eventType) continue;
      eventCount += 1;
      uniqueEventIds.add(parsed.eventId);
      countsByType.set(parsed.eventType, (countsByType.get(parsed.eventType) || 0) + 1);
      fileCounts.set(parsed.eventType, (fileCounts.get(parsed.eventType) || 0) + 1);
    }
    perFile.push({
      path: filePath,
      eventCount: Array.from(fileCounts.values()).reduce((sum, count) => sum + count, 0),
      countsByType: Object.fromEntries(
        Array.from(fileCounts.entries()).sort(([left], [right]) => left.localeCompare(right))
      )
    });
  }

  const required = Object.fromEntries(
    BENCH_DIAGNOSTIC_EVENT_TYPES.map((type) => [type, countsByType.get(type) || 0])
  );
  const unknownTypeCount = Array.from(countsByType.entries())
    .filter(([type]) => !knownTypes.has(type))
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    schemaVersion: BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
    fileCount: files.length,
    files: perFile,
    eventCount,
    uniqueEventCount: uniqueEventIds.size,
    countsByType: Object.fromEntries(
      Array.from(countsByType.entries()).sort(([left], [right]) => left.localeCompare(right))
    ),
    required,
    unknownTypeCount,
    malformedLines
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
  const diagnosticsStream = buildDiagnosticsStreamSummary(resultsRoot);
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
      crashRetention,
      stream: diagnosticsStream
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
