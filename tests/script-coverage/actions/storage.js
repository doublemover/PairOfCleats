import path from 'node:path';

export const buildStorageActions = ({ root, runNode, skipSqliteIncremental }) => {
  const actions = [];

  if (!skipSqliteIncremental) {
    actions.push({
      label: 'sqlite-incremental-test',
      run: () => runNode('sqlite-incremental-test', path.join(root, 'tests', 'storage', 'sqlite', 'incremental', 'file-manifest-updates.test.js')),
      covers: ['sqlite-incremental-test']
    });
    actions.push({
      label: 'sqlite-incremental-no-change-test',
      run: () => runNode('sqlite-incremental-no-change-test', path.join(root, 'tests', 'sqlite-incremental-no-change.js')),
      covers: ['sqlite-incremental-no-change-test']
    });
    actions.push({
      label: 'sqlite-bundle-missing-test',
      run: () => runNode('sqlite-bundle-missing-test', path.join(root, 'tests', 'sqlite-bundle-missing.js')),
      covers: ['sqlite-bundle-missing-test']
    });
  }

  actions.push(
    {
      label: 'sqlite-compact-test',
      run: () => runNode('sqlite-compact-test', path.join(root, 'tests', 'sqlite-compact.js')),
      covers: ['sqlite-compact-test', 'compact-sqlite-index'],
      coversTierB: ['compact-sqlite-index']
    },
    {
      label: 'sqlite-sidecar-cleanup-test',
      run: () => runNode('sqlite-sidecar-cleanup-test', path.join(root, 'tests', 'sqlite-sidecar-cleanup.js')),
      covers: ['sqlite-sidecar-cleanup-test']
    },
    {
      label: 'sqlite-ann-extension-test',
      run: () => runNode('sqlite-ann-extension-test', path.join(root, 'tests', 'sqlite-ann-extension.js')),
      covers: ['sqlite-ann-extension-test']
    },
    {
      label: 'sqlite-vec-candidate-set-test',
      run: () => runNode('sqlite-vec-candidate-set-test', path.join(root, 'tests', 'sqlite-vec-candidate-set.js')),
      covers: ['sqlite-vec-candidate-set-test']
    },
    {
      label: 'sqlite-build-manifest-test',
      run: () => runNode('sqlite-build-manifest-test', path.join(root, 'tests', 'sqlite-build-manifest.js')),
      covers: ['sqlite-build-manifest-test']
    },
    {
      label: 'sqlite-build-vocab-test',
      run: () => runNode('sqlite-build-vocab-test', path.join(root, 'tests', 'sqlite-build-vocab.js')),
      covers: ['sqlite-build-vocab-test']
    },
    {
      label: 'sqlite-build-delete-test',
      run: () => runNode('sqlite-build-delete-test', path.join(root, 'tests', 'sqlite-build-delete.js')),
      covers: ['sqlite-build-delete-test']
    },
    {
      label: 'hnsw-ann-test',
      run: () => runNode('hnsw-ann-test', path.join(root, 'tests', 'hnsw-ann.js')),
      covers: ['hnsw-ann-test']
    },
    {
      label: 'lancedb-ann-test',
      run: () => runNode('lancedb-ann-test', path.join(root, 'tests', 'lancedb-ann.js')),
      covers: ['lancedb-ann-test']
    },
    {
      label: 'tantivy-smoke-test',
      run: () => runNode('tantivy-smoke-test', path.join(root, 'tests', 'tantivy-smoke.js')),
      covers: ['tantivy-smoke-test']
    },
    {
      label: 'hnsw-atomic-test',
      run: () => runNode('hnsw-atomic-test', path.join(root, 'tests', 'hnsw-atomic.js')),
      covers: ['hnsw-atomic-test']
    },
    {
      label: 'hnsw-candidate-set-test',
      run: () => runNode('hnsw-candidate-set-test', path.join(root, 'tests', 'hnsw-candidate-set.js')),
      covers: ['hnsw-candidate-set-test']
    },
    {
      label: 'hnsw-distance-metrics-test',
      run: () => runNode('hnsw-distance-metrics-test', path.join(root, 'tests', 'hnsw-distance-metrics.js')),
      covers: ['hnsw-distance-metrics-test']
    },
    {
      label: 'sqlite-chunk-id-test',
      run: () => runNode('sqlite-chunk-id-test', path.join(root, 'tests', 'sqlite-chunk-id.js')),
      covers: ['sqlite-chunk-id-test']
    },
    {
      label: 'sqlite-auto-backend-test',
      run: () => runNode('sqlite-auto-backend-test', path.join(root, 'tests', 'sqlite-auto-backend.js')),
      covers: ['sqlite-auto-backend-test']
    },
    {
      label: 'sqlite-missing-dep-test',
      run: () => runNode('sqlite-missing-dep-test', path.join(root, 'tests', 'sqlite-missing-dep.js')),
      covers: ['sqlite-missing-dep-test']
    },
    {
      label: 'sqlite-cache-test',
      run: () => runNode('sqlite-cache-test', path.join(root, 'tests', 'sqlite-cache.js')),
      covers: ['sqlite-cache-test']
    },
    {
      label: 'sqlite-build-indexes-test',
      run: () => runNode('sqlite-build-indexes-test', path.join(root, 'tests', 'sqlite-build-indexes.js')),
      covers: []
    },
    {
      label: 'sqlite-chunk-meta-streaming-test',
      run: () => runNode('sqlite-chunk-meta-streaming-test', path.join(root, 'tests', 'sqlite-chunk-meta-streaming.js')),
      covers: ['sqlite-chunk-meta-streaming-test']
    },
    {
      label: 'lmdb-backend-test',
      run: () => runNode('lmdb-backend-test', path.join(root, 'tests', 'lmdb-backend.js')),
      covers: ['build-lmdb-index', 'lmdb-backend-test'],
      coversTierB: ['build-lmdb-index']
    },
    {
      label: 'two-stage-state-test',
      run: () => runNode('two-stage-state-test', path.join(root, 'tests', 'two-stage-state.js')),
      covers: []
    }
  );

  return actions;
};
