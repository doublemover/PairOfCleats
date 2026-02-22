import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../../src/shared/progress.js';
import {
  STAGE_TIMING_SCHEMA_VERSION,
  buildStageTimingProfileForTask,
  computeLowHitSeverity,
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

const REMEDIATION_SCHEMA_VERSION = 1;
const LOW_HIT_THRESHOLD = 0.82;

const roundValue = (value, digits = 4) => {
  if (!Number.isFinite(Number(value))) return null;
  const scale = 10 ** Math.max(0, Math.floor(Number(digits) || 0));
  return Math.round(Number(value) * scale) / scale;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const buildSuggestion = ({
  suggestionId,
  component,
  title,
  score,
  reason,
  targetFiles,
  severity
}) => ({
  suggestionId,
  component,
  title,
  score: roundValue(clamp01(score), 3),
  reason,
  targetFiles: Array.isArray(targetFiles) ? targetFiles : [],
  loop: {
    accepted: false,
    baseline: {
      bestHitRate: roundValue(severity.bestHitRate, 4),
      queryWallMsPerSearch: roundValue(severity.queryWallMsPerSearch, 2),
      avgResultCount: roundValue(severity.avgResultCount, 3)
    },
    postChange: null,
    delta: null
  }
});

const buildRankedRemediationSuggestions = ({ severity }) => {
  const suggestions = [];
  if (!Number.isFinite(severity?.bestHitRate) || !Number.isFinite(severity?.hitGap)) return suggestions;

  suggestions.push(buildSuggestion({
    suggestionId: 'query.intent-weight-rebalance',
    component: 'ranker',
    title: 'Rebalance intent weights by language family',
    score: 0.45 + (severity.hitGap * 1.35) + (severity.scarcityPressure * 0.25),
    reason: (
      `best hit ${(severity.bestHitRate * 100).toFixed(1)}% is below ` +
      `${(severity.lowHitThreshold * 100).toFixed(1)}%; calibrate symbol/type/api/behavior weights.`
    ),
    targetFiles: [
      'tools/bench/query-generator.js',
      'benchmarks/repos.json'
    ],
    severity
  }));

  if (severity.scarcityPressure > 0.05 || severity.bestHitRate < (severity.lowHitThreshold * 0.9)) {
    suggestions.push(buildSuggestion({
      suggestionId: 'tokenizer.language-family-pack',
      component: 'tokenizer',
      title: 'Expand language-family tokenizer coverage',
      score: 0.30 + (severity.hitGap * 1.15) + (severity.scarcityPressure * 0.35),
      reason: (
        `avg hits/search ${roundValue(severity.avgResultCount, 2) ?? 'n/a'} indicates sparse recall; ` +
        'prioritize dictionary/token normalization updates for this family.'
      ),
      targetFiles: [
        'src/retrieval/query-intent.js',
        'tools/bench/query-generator.js'
      ],
      severity
    }));
  }

  if (severity.latencyPressure > 0) {
    suggestions.push(buildSuggestion({
      suggestionId: 'ranker.rerank-budget',
      component: 'ranker',
      title: 'Tune rerank budget for low-hit queries',
      score: 0.20 + (severity.hitGap * 0.85) + (severity.latencyPressure * 0.65),
      reason: (
        `query/search latency ${roundValue(severity.queryWallMsPerSearch, 1) ?? 'n/a'}ms with low hit rate; ` +
        'tighten rerank depth and rebalance first-pass confidence thresholds.'
      ),
      targetFiles: [
        'src/retrieval/pipeline/rank-stage.js',
        'src/retrieval/scoring/ann-candidate-policy.js'
      ],
      severity
    }));
  }

  if ((severity.avgResultCount || 0) < 1.2 || severity.bestHitRate < 0.6) {
    suggestions.push(buildSuggestion({
      suggestionId: 'indexing.chunking-balance',
      component: 'indexing',
      title: 'Tune chunking/normalization for recall',
      score: 0.15 + (severity.hitGap * 0.75) + (severity.scarcityPressure * 0.4),
      reason: (
        'low result density suggests chunk boundary or normalization drift; tune language-role chunk sizing and indexing presets.'
      ),
      targetFiles: [
        'src/index/chunking/dispatch.js',
        'src/index/chunking/limits.js'
      ],
      severity
    }));
  }

  return suggestions
    .sort((left, right) => Number(right.score) - Number(left.score))
    .map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
};

const buildRemediationSummary = (tasks) => {
  const remediationRows = [];
  const aggregateSuggestions = new Map();
  const validTasks = (Array.isArray(tasks) ? tasks : []).filter((entry) => entry?.summary);
  for (const entry of validTasks) {
    const severity = computeLowHitSeverity({
      summary: entry.summary,
      lowHitThreshold: LOW_HIT_THRESHOLD
    });
    if (!Number.isFinite(severity?.bestHitRate) || severity.bestHitRate >= LOW_HIT_THRESHOLD) continue;
    const rankedSuggestions = buildRankedRemediationSuggestions({ severity });
    for (const suggestion of rankedSuggestions) {
      if (!aggregateSuggestions.has(suggestion.suggestionId)) {
        aggregateSuggestions.set(suggestion.suggestionId, {
          suggestionId: suggestion.suggestionId,
          title: suggestion.title,
          component: suggestion.component,
          uses: 0,
          scoreTotal: 0,
          repos: []
        });
      }
      const bucket = aggregateSuggestions.get(suggestion.suggestionId);
      bucket.uses += 1;
      bucket.scoreTotal += Number(suggestion.score) || 0;
      bucket.repos.push(`${entry.language}/${entry.repo}`);
    }
    remediationRows.push({
      language: entry.language,
      tier: entry.tier,
      repo: entry.repo,
      repoPath: entry.repoPath || null,
      outFile: entry.outFile || null,
      bestHitRate: roundValue(severity.bestHitRate, 4),
      lowHitThreshold: LOW_HIT_THRESHOLD,
      hitGap: roundValue(severity.hitGap, 4),
      avgResultCount: roundValue(severity.avgResultCount, 3),
      queryWallMsPerSearch: roundValue(severity.queryWallMsPerSearch, 2),
      queryWallMsPerQuery: roundValue(severity.queryWallMsPerQuery, 2),
      severityScore: roundValue(severity.severityScore, 3),
      rankedSuggestions
    });
  }
  remediationRows.sort((left, right) => (
    Number(right.severityScore || 0) - Number(left.severityScore || 0)
  ));
  const topSuggestions = Array.from(aggregateSuggestions.values())
    .map((entry) => ({
      suggestionId: entry.suggestionId,
      title: entry.title,
      component: entry.component,
      uses: entry.uses,
      avgScore: roundValue(entry.uses > 0 ? (entry.scoreTotal / entry.uses) : 0, 3),
      repos: entry.repos.sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => (Number(right.avgScore || 0) - Number(left.avgScore || 0))
      || (Number(right.uses || 0) - Number(left.uses || 0))
      || left.suggestionId.localeCompare(right.suggestionId));
  const totalSuggestions = remediationRows.reduce((sum, entry) => (
    sum + (Array.isArray(entry.rankedSuggestions) ? entry.rankedSuggestions.length : 0)
  ), 0);
  return {
    schemaVersion: REMEDIATION_SCHEMA_VERSION,
    lowHitThreshold: LOW_HIT_THRESHOLD,
    reposConsidered: validTasks.length,
    lowHitCount: remediationRows.length,
    lowHitRepos: remediationRows,
    topSuggestions,
    loop: {
      trackedSuggestions: totalSuggestions,
      acceptedSuggestions: 0,
      pendingSuggestions: totalSuggestions,
      postChangeDeltaReady: false
    }
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
  const remediation = buildRemediationSummary(tasks);
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
    remediation,
    groupedSummary,
    overallSummary
  };
};
