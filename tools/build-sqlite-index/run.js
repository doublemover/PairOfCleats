import { parseBuildSqliteArgs } from './args.js';
import { runBuildSqliteIndexWithConfig } from './runner.js';
export { resolveOutputPaths } from './output-paths.js';

export async function runBuildSqliteIndex(rawArgs = process.argv.slice(2), options = {}) {
  const parsed = parseBuildSqliteArgs(rawArgs, options);
  return runBuildSqliteIndexWithConfig(parsed, options);
}
