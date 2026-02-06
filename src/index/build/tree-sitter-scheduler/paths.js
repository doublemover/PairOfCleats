import path from 'node:path';

const sanitizeKey = (value) => {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return 'unknown';
  // Keep filenames safe and stable on Windows.
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
};

export const resolveTreeSitterSchedulerPaths = (indexDir) => {
  const baseDir = path.join(indexDir, 'tree-sitter');
  const jobsDir = path.join(baseDir, 'jobs');
  const resultsDir = path.join(baseDir, 'results');
  return {
    baseDir,
    jobsDir,
    resultsDir,
    planPath: path.join(baseDir, 'plan.json'),
    jobPathForWasmKey: (wasmKey) => path.join(jobsDir, `${sanitizeKey(wasmKey)}.jsonl`),
    resultsPathForWasmKey: (wasmKey) => path.join(resultsDir, `${sanitizeKey(wasmKey)}.jsonl`),
    resultsIndexPathForWasmKey: (wasmKey) => path.join(resultsDir, `${sanitizeKey(wasmKey)}.vfsidx`)
  };
};

