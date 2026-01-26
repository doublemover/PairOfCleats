import { parseBuildEmbeddingsArgs } from './args.js';
import { runBuildEmbeddingsWithConfig } from './runner.js';

export async function runBuildEmbeddings(rawArgs = process.argv.slice(2), _options = {}) {
  const config = parseBuildEmbeddingsArgs(rawArgs, _options);
  return runBuildEmbeddingsWithConfig(config);
}
