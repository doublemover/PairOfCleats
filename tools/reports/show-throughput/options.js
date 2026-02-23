import fs from 'node:fs';
import path from 'node:path';

/**
 * Check whether argv includes a flag token.
 *
 * @param {string[]} argv
 * @param {string} flag
 * @returns {boolean}
 */
const hasFlag = (argv, flag) => Array.isArray(argv) && argv.includes(flag);

/**
 * Resolve CLI options for throughput report rendering.
 *
 * @param {{argv?:string[],cwd?:string}} [input]
 * @returns {{
 *   resultsRoot:string,
 *   refreshJson:boolean,
 *   deepAnalysis:boolean,
 *   verboseOutput:boolean,
 *   includeUsrGuardrails:boolean
 * }}
 */
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

/**
 * Validate results root path exists before attempting report traversal.
 *
 * @param {string} resultsRoot
 * @returns {boolean}
 */
export const validateResultsRoot = (resultsRoot) => (
  typeof resultsRoot === 'string'
  && resultsRoot.length > 0
  && fs.existsSync(resultsRoot)
);
