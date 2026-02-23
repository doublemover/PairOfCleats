const toSafeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.floor(parsed);
};

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
