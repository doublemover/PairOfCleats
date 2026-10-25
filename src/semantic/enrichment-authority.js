import path from 'node:path';
import { loadUserConfig, getToolingConfig } from '../shared/dict-utils.js';
import { resolveRepoCacheRootPath } from '../shared/repo-paths.js';
import { getEnvConfig } from '../shared/env/runtime.js';
import { buildContentConfigHash } from '../index/build/runtime/hash.js';
import { semanticHash } from '../index/semantic/identity.js';
import { isWithinRoot, toRealPathSync } from '../workspace/identity.js';

/** One immutable drain owner. Configuration is revalidated live rather than
 * forced into the normal builder after authority may have been revoked. */
export const captureEnrichmentAuthority = ({ repoRoot, userConfig }) => {
  const project = (root, config) => {
    const repository = toRealPathSync(root);
    // Path resolution must not acquire access to a different live cache owner.
    const cache = toRealPathSync(resolveRepoCacheRootPath(root, config));
    const builds = toRealPathSync(path.join(cache, 'builds'));
    const identity = semanticHash('pairofcleats.semantic.drain-authority.v1', {
      repository, cache, builds, content: buildContentConfigHash(config, getEnvConfig()),
      tooling: getToolingConfig(root, config)
    });
    return Object.freeze({ repository, cache, builds, identity });
  };
  const admitted = project(repoRoot, userConfig);
  const stale = actual => Object.assign(new Error('Semantic drain configuration or publication authority changed.'), {
    code: 'ERR_SEMANTIC_ENRICHMENT_STALE', reason: 'enrichment-authority-changed',
    details: { reason: 'enrichment-authority-changed', expected: admitted.identity, actual: actual?.identity || null }
  });
  const verify = (candidate = null) => {
    const current = project(repoRoot, loadUserConfig(repoRoot));
    if (current.identity !== admitted.identity) throw stale(current);
    if (!candidate) return;
    const selected = project(candidate.root, candidate.userConfig);
    if (selected.identity !== admitted.identity) throw stale(selected);
    if (candidate.repoCacheRoot && toRealPathSync(candidate.repoCacheRoot) !== admitted.cache) throw stale(selected);
    if (candidate.buildRoot) {
      const root = toRealPathSync(candidate.buildRoot);
      if (!isWithinRoot(root, admitted.builds) || path.dirname(root) !== admitted.builds
        || typeof candidate.buildId !== 'string' || path.basename(candidate.buildId) !== candidate.buildId
        || toRealPathSync(path.join(admitted.builds, candidate.buildId)) !== root) throw stale(selected);
    }
  };
  return Object.freeze({ identity: admitted.identity, verify });
};
