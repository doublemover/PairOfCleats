const toSafeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.floor(parsed);
};

const HEAVY_BENCH_LANGUAGE_IDS = new Set([
  'c',
  'clike',
  'cmake',
  'cpp',
  'csharp',
  'go',
  'java',
  'kotlin',
  'protobuf',
  'proto',
  'python',
  'ruby',
  'rust',
  'scala',
  'sql',
  'starlark',
  'swift'
]);

const mapSize = (value) => {
  if (value instanceof Map || value instanceof Set) return value.size;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
};

export const summarizeBenchLineStats = (lineStats) => {
  const totals = lineStats?.totals && typeof lineStats.totals === 'object'
    ? lineStats.totals
    : {};
  const linesByFile = lineStats?.linesByFile && typeof lineStats.linesByFile === 'object'
    ? lineStats.linesByFile
    : {};
  const codeLines = toSafeInt(totals.code);
  const proseLines = toSafeInt(totals.prose);
  const extractedProseLines = toSafeInt(totals['extracted-prose']);
  const recordsLines = toSafeInt(totals.records);
  const codeFiles = mapSize(linesByFile.code);
  const proseFiles = mapSize(linesByFile.prose);
  const extractedProseFiles = mapSize(linesByFile['extracted-prose']);
  const recordsFiles = mapSize(linesByFile.records);
  const weightedLines = codeLines + proseLines + recordsLines + Math.floor(extractedProseLines * 0.35);
  const weightedFiles = codeFiles + proseFiles + recordsFiles + Math.floor(extractedProseFiles * 0.35);
  return {
    codeLines,
    proseLines,
    extractedProseLines,
    recordsLines,
    codeFiles,
    proseFiles,
    extractedProseFiles,
    recordsFiles,
    weightedLines,
    weightedFiles,
    totalLines: codeLines + proseLines + extractedProseLines + recordsLines,
    totalFiles: codeFiles + proseFiles + extractedProseFiles + recordsFiles
  };
};

export const resolveAdaptiveBenchTimeoutMs = ({
  baseTimeoutMs,
  lineStats = null,
  buildIndex = false,
  buildSqlite = false,
  queryCount = 0,
  backendCount = 0,
  queryConcurrency = 4,
  realEmbeddings = true,
  minFloorMs = 12 * 60 * 1000,
  maxTimeoutMs = 2 * 60 * 60 * 1000
} = {}) => {
  const base = toSafeInt(baseTimeoutMs);
  if (base === 0) return 0;
  if (!buildIndex) return base;
  const summary = summarizeBenchLineStats(lineStats);
  const hasEstimatedWork = summary.weightedLines > 0 || summary.weightedFiles > 0;
  const sparseLineBudgetMs = summary.weightedLines > 0
    ? Math.ceil(summary.weightedLines / 1300) * 1000
    : 0;
  const embeddingLineBudgetMs = realEmbeddings && summary.weightedLines > 0
    ? Math.ceil(summary.weightedLines / 300) * 1000
    : 0;
  const perFileBudgetMs = realEmbeddings ? 1200 : 320;
  const fileBudgetMs = summary.weightedFiles > 0
    ? summary.weightedFiles * perFileBudgetMs
    : 0;
  const normalizedQueries = toSafeInt(queryCount);
  const normalizedBackends = Math.max(0, toSafeInt(backendCount));
  const normalizedQueryConcurrency = Math.max(1, toSafeInt(queryConcurrency, 4));
  const querySearches = normalizedQueries * normalizedBackends;
  const queryWaves = querySearches > 0 ? Math.ceil(querySearches / normalizedQueryConcurrency) : 0;
  const queryLineFactorMs = summary.weightedLines > 0
    ? Math.min(120000, Math.ceil(summary.weightedLines / 350))
    : 0;
  const queryFileFactorMs = summary.weightedFiles > 0
    ? Math.min(60000, Math.ceil(summary.weightedFiles * 8))
    : 0;
  const perSearchBudgetMs = querySearches > 0
    ? (400 + queryLineFactorMs + queryFileFactorMs)
    : 0;
  const queryBudgetMs = querySearches > 0
    ? (queryWaves * perSearchBudgetMs) + (45 * 1000)
    : 0;
  const fixedOverheadMs = (8 * 60 * 1000) + (buildSqlite ? 4 * 60 * 1000 : 0);
  const buildBudgetMs = hasEstimatedWork
    ? Math.max(sparseLineBudgetMs, embeddingLineBudgetMs, fileBudgetMs)
    : 0;
  const floor = Math.max(
    toSafeInt(minFloorMs, 12 * 60 * 1000),
    fixedOverheadMs + buildBudgetMs + queryBudgetMs
  );
  let effective = Math.max(base, floor);
  const cap = toSafeInt(maxTimeoutMs, 2 * 60 * 60 * 1000);
  if (cap > 0) effective = Math.min(effective, cap);
  return effective;
};

export const resolveBenchRuntimeAdaptationPlan = ({
  repoTimeoutMs,
  language = null,
  lineStats = null,
  buildIndex = false,
  buildSqlite = false,
  queryCount = 0,
  backendCount = 0,
  queryConcurrency = 4,
  realEmbeddings = true,
  requestedThreads = null
} = {}) => {
  const requestedThreadsCount = toSafeInt(requestedThreads);
  const normalizedLanguage = String(language || '').trim().toLowerCase();
  const lineSummary = summarizeBenchLineStats(lineStats);
  let repoTier = 'small';
  if (lineSummary.weightedFiles >= 60_000 || lineSummary.weightedLines >= 3_000_000) {
    repoTier = 'xlarge';
  } else if (lineSummary.weightedFiles >= 12_000 || lineSummary.weightedLines >= 750_000) {
    repoTier = 'large';
  } else if (lineSummary.weightedFiles >= 2_500 || lineSummary.weightedLines >= 150_000) {
    repoTier = 'medium';
  } else if (lineSummary.weightedFiles === 0 && lineSummary.weightedLines === 0) {
    repoTier = 'unknown';
  }
  const heavyLanguage = HEAVY_BENCH_LANGUAGE_IDS.has(normalizedLanguage);
  const adaptationReasons = [];
  if (repoTier === 'large' || repoTier === 'xlarge') adaptationReasons.push(`repo-tier:${repoTier}`);
  if (heavyLanguage) adaptationReasons.push(`heavy-language:${normalizedLanguage}`);
  if (buildIndex) adaptationReasons.push('build-index');
  if (buildSqlite) adaptationReasons.push('build-sqlite');
  const adaptiveRepoTimeoutMs = resolveAdaptiveBenchTimeoutMs({
    baseTimeoutMs: repoTimeoutMs,
    lineStats,
    buildIndex,
    buildSqlite,
    queryCount,
    backendCount,
    queryConcurrency,
    realEmbeddings
  });
  let recommendedThreads = null;
  if (!(requestedThreadsCount > 0) && buildIndex) {
    if (repoTier === 'xlarge') {
      recommendedThreads = heavyLanguage ? 2 : 3;
    } else if (repoTier === 'large' && heavyLanguage) {
      recommendedThreads = 3;
    } else if (repoTier === 'large' && buildSqlite) {
      recommendedThreads = 4;
    }
  }
  if (recommendedThreads != null) {
    adaptationReasons.push(`threads:${recommendedThreads}`);
  }
  return {
    repoTimeoutMs: adaptiveRepoTimeoutMs,
    repoShape: {
      tier: repoTier,
      heavyLanguage,
      language: normalizedLanguage || null,
      weightedLines: lineSummary.weightedLines,
      weightedFiles: lineSummary.weightedFiles,
      buildIndex: buildIndex === true,
      buildSqlite: buildSqlite === true,
      realEmbeddings: realEmbeddings !== false
    },
    recommendedThreads,
    adapted: adaptiveRepoTimeoutMs !== toSafeInt(repoTimeoutMs),
    adaptationReasons
  };
};

export const resolveBenchProcessTimeoutProfile = ({
  repoTimeoutMs,
  hardTimeoutScale = 1.5,
  hardTimeoutPaddingMs = 20 * 60 * 1000,
  maxHardTimeoutMs = 4 * 60 * 60 * 1000
} = {}) => {
  const idleTimeoutMs = toSafeInt(repoTimeoutMs);
  if (idleTimeoutMs === 0) {
    return {
      idleTimeoutMs: 0,
      hardTimeoutMs: 0
    };
  }
  const scale = Number.isFinite(Number(hardTimeoutScale)) && Number(hardTimeoutScale) > 1
    ? Number(hardTimeoutScale)
    : 1.5;
  const paddingMs = toSafeInt(hardTimeoutPaddingMs, 20 * 60 * 1000);
  const capMs = toSafeInt(maxHardTimeoutMs, 4 * 60 * 60 * 1000);
  const hardTimeoutMs = idleTimeoutMs > 0
    ? Math.min(
      capMs,
      Math.max(
        idleTimeoutMs,
        idleTimeoutMs + paddingMs,
        Math.ceil(idleTimeoutMs * scale)
      )
    )
    : 0;
  return {
    idleTimeoutMs,
    hardTimeoutMs
  };
};
