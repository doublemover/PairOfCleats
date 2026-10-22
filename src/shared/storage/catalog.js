import path from 'node:path';

// Exact adoption seams and intentional exceptions; a catalog entry is not proof
// that a directory exists, is owned, is complete, or is safe to delete.
export const STORAGE_CLASS_CATALOG = Object.freeze([
  ['machine-config', 'config', 'durable', 'src/shared/config-authority.js', 'machine'],
  ['workspace-registries', 'state', 'durable', 'src/workspace', 'workspace'],
  ['repo-builds', 'repos', 'referenced', 'src/shared/repo-paths.js', 'repository'],
  ['incremental-bundles', 'repos', 'referenced', 'src/index/build/incremental', 'repository'],
  ['preprocess-snapshot', 'repos', 'derived', 'src/index/build/preprocess.js', 'repository'],
  ['semantic-snapshots', 'repos', 'referenced', 'src/index/build/incremental', 'repository'],
  ['backend-databases', 'repos', 'referenced', 'src/storage', 'repository'],
  ['snapshot-registry', 'repos', 'evidence', 'src/index/snapshots/registry.js', 'repository'],
  ['diff-registry', 'repos', 'evidence', 'src/index/diffs/registry.js', 'repository'],
  ['triage-records', 'repos', 'evidence', 'tools/dict-utils/paths/triage.js', 'repository'],
  ['query-result-plan-caches', 'repos', 'derived', 'src/retrieval/cli/cache-paths.js', 'repository'],
  ['embedding-profiles', 'repos', 'referenced', 'src/shared/embeddings-cache/layout.js', 'repository'],
  ['cas-objects', 'cas', 'referenced', 'src/shared/cache-cas', 'shared'],
  ['command-probes', 'cache', 'derived', 'src/index/tooling/command-probe-persistent-cache.js', 'shared'],
  ['lsp-workspace-state', 'repos', 'referenced', 'src/integrations/tooling', 'repository'],
  ['models-onnx-sidecars', 'models', 'downloadable', 'src/shared/embedding-adapter.js', 'shared'],
  ['dictionaries', 'dictionaries', 'downloadable', 'tools/dict-utils/paths/dictionaries.js', 'shared'],
  ['extensions', 'extensions', 'downloadable', 'tools/dict-utils/paths/cache.js', 'shared'],
  ['managed-tools-sdks', 'tooling', 'downloadable', 'tools/tooling/install.js', 'shared'],
  ['managed-install-receipts', 'tooling', 'evidence', 'tools/tooling/install-receipts/<toolId>/<identity>.json', 'tool-profile'],
  ['managed-child-caches', 'shared', 'derived', 'src/shared/storage/child-environment.js', 'tool-profile'],
  ['logs-traces-metrics', 'logs', 'evidence', 'tools/dict-utils/paths/cache.js', 'repository'],
  ['reports-recordings', 'reports', 'evidence', 'tools/reports', 'repository'],
  ['temporary-scratch', 'tmp', 'temporary', 'src/shared/cache-roots.js', 'run'],
  ['publication-recovery', 'recovery', 'evidence', 'src/shared/io/replace-file.js', 'run'],
  ['portable-project-config', null, 'external', 'src/shared/config-authority.js', 'project'],
  ['editor-host-state', null, 'external', 'extensions/vscode;sublime;crates/pairofcleats-tui', 'host'],
  ['explicit-export-destinations', null, 'external', 'tools/reports', 'user'],
  ['global-tool-package-caches', null, 'external', 'src/shared/storage/child-environment.js', 'user']
].map(([id, category, retention, ownerModule, scope]) => Object.freeze({
  id, category, retention, ownerModule, scope,
  adoption: category ? 'descriptor-available-owner-adoption-required' : 'intentional-external-exception'
})));

export const EMBEDDING_PROTECTED_METADATA = Object.freeze([
  'cache.index.json', 'cache.index.delta', 'cache.meta.json'
]);

export const PREPROCESS_STORAGE_SURFACE = Object.freeze({
  relativePath: 'preprocess/snapshot.json', category: 'repos', retention: 'derived', scope: 'repository',
  sourceAuthority: 'content-verified-classification-and-line-products-only',
  membership: 'enumerated-each-attempt', absenceAuthority: 'continuous-snapshot-witness-required',
  leaseOwner: 'existing-repo-cache-writer', deletionAuthority: false
});

/** Known legacy locations only: no whole-disk discovery or implicit adoption. */
export const resolveLegacyStorageLocations = ({ home, cacheRoot, repoRoots = [], toolingRoot = null,
  modelsRoot = null, extensionsRoot = null, dictionariesRoot = null }) => {
  const entries = [
    ['legacy-models', modelsRoot || path.join(cacheRoot, 'models'), 'models', 'downloadable'],
    ['legacy-tooling', toolingRoot || path.join(home, 'tooling'), 'tooling', 'downloadable'],
    ['legacy-extensions', extensionsRoot || path.join(home, 'extensions'), 'extensions', 'downloadable'],
    ['legacy-dictionaries', dictionariesRoot || path.join(home, 'dictionaries'), 'dictionaries', 'downloadable'],
    ['legacy-command-probes', path.join(cacheRoot, 'tooling', 'command-probes'), 'shared', 'derived'],
    ['legacy-scratch', path.join(cacheRoot, 'tmp'), 'tmp', 'temporary']
  ];
  for (const root of repoRoots) {
    entries.push([`legacy-repo-${path.basename(root)}-preprocess-snapshot`,
      path.join(root, ...PREPROCESS_STORAGE_SURFACE.relativePath.split('/')), 'repos', 'derived']);
    for (const [child, retention] of [['triage', 'evidence'], ['snapshots', 'evidence'], ['diffs', 'evidence'],
      ['metrics', 'evidence'], ['builds', 'referenced'], ['query-cache', 'derived']]) {
      entries.push([`legacy-repo-${path.basename(root)}-${child}`, path.join(root, child),
        ['evidence'].includes(retention) ? 'reports' : 'repos', retention]);
    }
  }
  return entries.map(([id, location, category, retention]) => ({ id, path: path.resolve(location), category,
    retention, provenance: 'known-legacy-location', deletionAuthority: false, adoptionRequired: true }));
};
