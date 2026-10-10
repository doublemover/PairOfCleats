import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot, getBuildsRoot } from '../shared/repo-paths.js';
import { resolveCacheScopedBuildIdRoot } from '../shared/indexing/build-pointer-roots.js';
import { resolveIndexDir } from '../retrieval/cli-index.js';

/** Resolve a retained build by its exact immutable ID before considering current. */
export const resolveSemanticGenerationIndexDir = async ({ repoRoot, generation, userConfig }) => {
  const buildId = generation.baseBuildId;
  if (buildId === '.' || buildId === '..' || /[\\/:\0]/.test(buildId)) throw Object.assign(new Error('Semantic generation ID must be a single build identifier.'), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = getBuildsRoot(repoRoot, userConfig);
  const retained = resolveCacheScopedBuildIdRoot(buildId, repoCacheRoot, buildsRoot);
  if (retained) {
    const indexDir = path.join(retained, 'index-code');
    try {
      if ((await fs.stat(path.join(indexDir, 'semantic_manifest.json'))).isFile()) return indexDir;
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  // The opener must validate explicit generation equality; never substitute current facts.
  return resolveIndexDir(repoRoot, 'code', userConfig);
};
