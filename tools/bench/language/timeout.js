const toSafeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.floor(parsed);
};

const mapSize = (value) => (value instanceof Map ? value.size : 0);

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
  minFloorMs = 12 * 60 * 1000,
  maxTimeoutMs = 2 * 60 * 60 * 1000
} = {}) => {
  const base = toSafeInt(baseTimeoutMs);
  if (base === 0) return 0;
  if (!buildIndex) return base;
  const summary = summarizeBenchLineStats(lineStats);
  const lineBudgetMs = Math.ceil(Math.max(1, summary.weightedLines) / 1300) * 1000;
  const fileBudgetMs = Math.max(1, summary.weightedFiles) * 220;
  const fixedOverheadMs = (8 * 60 * 1000) + (buildSqlite ? 4 * 60 * 1000 : 0);
  const floor = Math.max(toSafeInt(minFloorMs, 12 * 60 * 1000), fixedOverheadMs + Math.max(lineBudgetMs, fileBudgetMs));
  let effective = Math.max(base, floor);
  const cap = toSafeInt(maxTimeoutMs, 2 * 60 * 60 * 1000);
  if (cap > 0) effective = Math.min(effective, cap);
  return effective;
};
