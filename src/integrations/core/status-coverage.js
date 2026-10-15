import path from 'node:path';
import { readJsonFileSyncSafe } from '../../shared/file-read.js';
import { getScmProviderAndRoot } from '../../index/scm/registry.js';

export const compareIndexRevision = (recorded, current) => {
  const indexedCommit = recorded?.head?.commitId || recorded?.commit;
  const currentCommit = current?.head?.commitId || current?.commit;
  if (!indexedCommit || !currentCommit) return 'unknown';
  if (indexedCommit !== currentCommit) return 'revision-changed';
  if (current.dirty === true || recorded.dirty === true) return 'working-tree-unverified';
  return current.dirty === false && recorded.dirty === false ? 'same-clean-revision' : 'unknown';
};

export const readCurrentProvenance = async (repoRoot, provider) => {
  try {
    const selected = getScmProviderAndRoot({ startPath: repoRoot, provider });
    return await selected.providerImpl.getRepoProvenance({ repoRoot: selected.repoRoot });
  } catch { return null; }
};

/** Read bounded persisted evidence; never equate a saved receipt with live freshness. */
export const readIndexCoverage = ({ metricsDir, indexes, repoCacheRoot, currentProvenance = null }) => {
  const read = (file) => readJsonFileSyncSafe(file, { maxBytes: 8 * 1024 * 1024 });
  const modes = Object.fromEntries(Object.entries(indexes).map(([mode, indexDir]) => {
    const metrics = read(path.join(metricsDir, `index-${mode}.json`));
    const matchesActiveIndex = typeof metrics?.indexDir === 'string'
      && path.resolve(metrics.indexDir) === path.resolve(indexDir);
    return [mode, {
      status: matchesActiveIndex ? 'recorded' : 'unavailable',
      generatedAt: matchesActiveIndex ? metrics.generatedAt ?? null : null,
      provenance: matchesActiveIndex ? metrics.repo?.provenance ?? null : null,
      revisionComparison: compareIndexRevision(matchesActiveIndex ? metrics.repo?.provenance : null, currentProvenance),
      files: matchesActiveIndex ? metrics.files ?? null : null,
      chunks: matchesActiveIndex ? metrics.chunks?.total ?? null : null
    }];
  }));
  const watch = read(path.join(repoCacheRoot, 'watch-state.json'));
  return {
    modes,
    workingTreeComparison: 'not-performed',
    currentProvenance,
    watcher: watch ? {
      status: 'last-recorded',
      consistency: watch.consistency ?? null,
      backlogDepth: watch.backlogDepth ?? null,
      lastEventAt: watch.lastEventAt ?? null,
      activeGeneration: watch.activeGeneration ?? null
    } : null
  };
};
