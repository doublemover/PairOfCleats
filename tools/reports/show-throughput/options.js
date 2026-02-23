import fs from 'node:fs';
import path from 'node:path';

const hasFlag = (argv, flag) => Array.isArray(argv) && argv.includes(flag);

export const resolveShowThroughputOptions = ({
  argv = process.argv.slice(2),
  cwd = process.cwd()
} = {}) => {
  const resultsRoot = path.join(cwd, 'benchmarks', 'results');
  const refreshJson = hasFlag(argv, '--refresh-json');
  return {
    resultsRoot,
    refreshJson,
    deepAnalysis: hasFlag(argv, '--deep-analysis') || refreshJson,
    verboseOutput: hasFlag(argv, '--verbose'),
    includeUsrGuardrails: hasFlag(argv, '--include-usr')
  };
};

export const validateResultsRoot = (resultsRoot) => (
  typeof resultsRoot === 'string'
  && resultsRoot.length > 0
  && fs.existsSync(resultsRoot)
);
