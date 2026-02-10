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
      run: () => runNode('sqlite-incremental-no-change-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-incremental-no-change.test.js')),
      covers: ['sqlite-incremental-no-change-test']
    });
    actions.push({
      label: 'sqlite-bundle-missing-test',
      run: () => runNode('sqlite-bundle-missing-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-bundle-missing.test.js')),
      covers: ['sqlite-bundle-missing-test']
    });
  }

  actions.push(
    {
      label: 'compact-sqlite-index-help',
      run: () => runNode(
        'compact-sqlite-index-help',
        path.join(root, 'tools', 'build', 'compact-sqlite-index.js'),
        ['--help']
      ),
      covers: ['compact-sqlite-index'],
      coversTierB: ['compact-sqlite-index']
    },
    {
      label: 'sqlite-sidecar-cleanup-test',
      run: () => runNode('sqlite-sidecar-cleanup-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-sidecar-cleanup.test.js')),
      covers: ['sqlite-sidecar-cleanup-test']
    },
    {
      label: 'sqlite-ann-extension-test',
      run: () => runNode('sqlite-ann-extension-test', path.join(root, 'tests', 'storage', 'sqlite', 'ann', 'sqlite-ann-extension.test.js')),
      covers: ['sqlite-ann-extension-test']
    },
    {
      label: 'sqlite-vec-candidate-set-test',
      run: () => runNode('sqlite-vec-candidate-set-test', path.join(root, 'tests', 'storage', 'sqlite', 'ann', 'sqlite-vec-candidate-set.test.js')),
      covers: ['sqlite-vec-candidate-set-test']
    },
    {
      label: 'sqlite-build-manifest-test',
      run: () => runNode('sqlite-build-manifest-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-build-manifest.test.js')),
      covers: ['sqlite-build-manifest-test']
    },
    {
      label: 'sqlite-build-vocab-test',
      run: () => runNode('sqlite-build-vocab-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-build-vocab.test.js')),
      covers: ['sqlite-build-vocab-test']
    },
    {
      label: 'sqlite-build-delete-test',
      run: () => runNode('sqlite-build-delete-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-build-delete.test.js')),
      covers: ['sqlite-build-delete-test']
    },
    {
      label: 'hnsw-ann-test',
      run: () => runNode('hnsw-ann-test', path.join(root, 'tests', 'retrieval', 'ann', 'hnsw-ann.test.js')),
      covers: ['hnsw-ann-test']
    },
    {
      label: 'lancedb-ann-test',
      run: () => runNode('lancedb-ann-test', path.join(root, 'tests', 'retrieval', 'ann', 'lancedb-ann.test.js')),
      covers: ['lancedb-ann-test']
    },
    {
      label: 'tantivy-smoke-test',
      run: () => runNode('tantivy-smoke-test', path.join(root, 'tests', 'smoke', 'tantivy-smoke.test.js')),
      covers: ['tantivy-smoke-test']
    },
    {
      label: 'hnsw-atomic-test',
      run: () => runNode('hnsw-atomic-test', path.join(root, 'tests', 'retrieval', 'ann', 'hnsw-atomic.test.js')),
      covers: ['hnsw-atomic-test']
    },
    {
      label: 'hnsw-candidate-set-test',
      run: () => runNode('hnsw-candidate-set-test', path.join(root, 'tests', 'retrieval', 'ann', 'hnsw-candidate-set.test.js')),
      covers: ['hnsw-candidate-set-test']
    },
    {
      label: 'hnsw-distance-metrics-test',
      run: () => runNode('hnsw-distance-metrics-test', path.join(root, 'tests', 'retrieval', 'ann', 'hnsw-distance-metrics.test.js')),
      covers: ['hnsw-distance-metrics-test']
    },
    {
      label: 'sqlite-chunk-id-test',
      run: () => runNode('sqlite-chunk-id-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-chunk-id.test.js')),
      covers: ['sqlite-chunk-id-test']
    },
    {
      label: 'sqlite-auto-backend-test',
      run: () => runNode('sqlite-auto-backend-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-auto-backend.test.js')),
      covers: ['sqlite-auto-backend-test']
    },
    {
      label: 'sqlite-missing-dep-test',
      run: () => runNode('sqlite-missing-dep-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-missing-dep.test.js')),
      covers: ['sqlite-missing-dep-test']
    },
    {
      label: 'sqlite-cache-test',
      run: () => runNode('sqlite-cache-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-cache.test.js')),
      covers: ['sqlite-cache-test']
    },
    {
      label: 'sqlite-build-indexes-test',
      run: () => runNode('sqlite-build-indexes-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-build-indexes.test.js')),
      covers: []
    },
    {
      label: 'sqlite-chunk-meta-streaming-test',
      run: () => runNode('sqlite-chunk-meta-streaming-test', path.join(root, 'tests', 'storage', 'sqlite', 'sqlite-chunk-meta-streaming.test.js')),
      covers: ['sqlite-chunk-meta-streaming-test']
    },
    {
      label: 'lmdb-backend-test',
      run: () => runNode('lmdb-backend-test', path.join(root, 'tests', 'storage', 'lmdb', 'lmdb-backend.test.js')),
      covers: ['build-lmdb-index', 'lmdb-backend-test'],
      coversTierB: ['build-lmdb-index']
    },
    {
      label: 'two-stage-state-test',
      run: () => runNode('two-stage-state-test', path.join(root, 'tests', 'indexing', 'runtime', 'two-stage-state.test.js')),
      covers: []
    }
  );

  return actions;
};
