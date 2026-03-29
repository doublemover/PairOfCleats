import path from 'node:path';

export const buildEmbeddingActions = ({ root, runNode }) => [
  {
    label: 'embeddings-validate-test',
    run: () => runNode('embeddings-validate-test', path.join(root, 'tests', 'indexing', 'embeddings', 'validate.test.js')),
    covers: ['embeddings-validate-test']
  },
  {
    label: 'embeddings-cache-identity-test',
    run: () => runNode('embeddings-cache-identity-test', path.join(root, 'tests', 'indexing', 'embeddings', 'cache-identity.test.js')),
    covers: ['embeddings-cache-identity-test']
  },
  {
    label: 'embeddings-identity-test',
    run: () => runNode('embeddings-identity-test', path.join(root, 'tests', 'indexing', 'embeddings', 'identity.test.js')),
    covers: ['embeddings-identity-test']
  },
  {
    label: 'embeddings-cache-index-contract-matrix-test',
    run: () => runNode('embeddings-cache-index-contract-matrix-test', path.join(root, 'tests', 'indexing', 'embeddings', 'cache-index-contract-matrix.test.js')),
    covers: ['embeddings-cache-invalidation-test', 'embeddings-cache-index-contract-matrix-test']
  },
  {
    label: 'embeddings-stub-fastpath-cache-contract-matrix-test',
    run: () => runNode(
      'embeddings-stub-fastpath-cache-contract-matrix-test',
      path.join(root, 'tests', 'indexing', 'embeddings', 'stub-fastpath-cache-contract-matrix.test.js')
    ),
    covers: [
      'embeddings-dims-mismatch-test',
      'embeddings-cache-cross-repo-reuse-test',
      'embeddings-cache-index-append-only-test',
      'embeddings-cache-partial-reuse-test',
      'embeddings-stub-fastpath-cache-contract-matrix-test'
    ]
  },
  {
    label: 'embeddings-dims-validation-test',
    run: () => runNode('embeddings-dims-validation-test', path.join(root, 'tests', 'indexing', 'embeddings', 'dims-validation.test.js')),
    covers: ['embeddings-dims-validation-test']
  },
  {
    label: 'embeddings-sqlite-dense-test',
    run: () => runNode('embeddings-sqlite-dense-test', path.join(root, 'tests', 'indexing', 'embeddings', 'sqlite-dense.test.js')),
    covers: ['embeddings-sqlite-dense-test']
  },
  {
    label: 'embedding-batch-policy-matrix-test',
    run: () => runNode('embedding-batch-policy-matrix-test', path.join(root, 'tests', 'indexing', 'embeddings', 'embedding-batch-policy-matrix.test.js')),
    covers: [
      'embedding-batch-multipliers-test',
      'embedding-batch-defaults-test',
      'embedding-batch-throughput-test',
      'embedding-queue-defaults-test',
      'embedding-batch-policy-matrix-test'
    ]
  },
  {
    label: 'build-embeddings-cache-test',
    run: () => runNode('build-embeddings-cache-test', path.join(root, 'tests', 'indexing', 'embeddings', 'build', 'embeddings-cache.test.js')),
    covers: ['build-embeddings-cache-test']
  },
  {
    label: 'embedding-autotune-profile-test',
    run: () => runNode('embedding-autotune-profile-test', path.join(root, 'tests', 'indexing', 'embeddings', 'embedding-autotune-profile.test.js')),
    covers: ['embedding-batch-autotune-test', 'embedding-autotune-profile-test']
  }
];
