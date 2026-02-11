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
  const resolveResultsExt = (format = 'jsonl') => (
    format === 'binary-v1' ? '.rows.bin' : '.jsonl'
  );
  return {
    baseDir,
    jobsDir,
    resultsDir,
    planPath: path.join(baseDir, 'plan.json'),
    jobPathForGrammarKey: (grammarKey) => path.join(jobsDir, `${sanitizeKey(grammarKey)}.jsonl`),
    resultsPathForGrammarKey: (grammarKey, format = 'jsonl') => (
      path.join(resultsDir, `${sanitizeKey(grammarKey)}${resolveResultsExt(format)}`)
    ),
    resultsIndexPathForGrammarKey: (grammarKey) => path.join(resultsDir, `${sanitizeKey(grammarKey)}.vfsidx`),
    resultsMetaPathForGrammarKey: (grammarKey) => path.join(resultsDir, `${sanitizeKey(grammarKey)}.meta.jsonl`)
  };
};
