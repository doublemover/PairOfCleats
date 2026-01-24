import path from 'node:path';

export const buildEmbeddingActions = ({ root, runNode }) => [
  {
    label: 'embeddings-validate-test',
    run: () => runNode('embeddings-validate-test', path.join(root, 'tests', 'embeddings-validate.js')),
    covers: ['embeddings-validate-test']
  },
  {
    label: 'embeddings-cache-identity-test',
    run: () => runNode('embeddings-cache-identity-test', path.join(root, 'tests', 'embeddings-cache-identity.js')),
    covers: ['embeddings-cache-identity-test']
  },
  {
    label: 'embeddings-identity-test',
    run: () => runNode('embeddings-identity-test', path.join(root, 'tests', 'embeddings-identity.js')),
    covers: ['embeddings-identity-test']
  },
  {
    label: 'embeddings-cache-invalidation-test',
    run: () => runNode('embeddings-cache-invalidation-test', path.join(root, 'tests', 'embeddings-cache-invalidation.js')),
    covers: ['embeddings-cache-invalidation-test']
  },
  {
    label: 'embeddings-dims-mismatch-test',
    run: () => runNode('embeddings-dims-mismatch-test', path.join(root, 'tests', 'embeddings-dims-mismatch.js')),
    covers: ['embeddings-dims-mismatch-test']
  },
  {
    label: 'embeddings-dims-validation-test',
    run: () => runNode('embeddings-dims-validation-test', path.join(root, 'tests', 'embeddings-dims-validation.js')),
    covers: ['embeddings-dims-validation-test']
  },
  {
    label: 'embeddings-sqlite-dense-test',
    run: () => runNode('embeddings-sqlite-dense-test', path.join(root, 'tests', 'embeddings-sqlite-dense.js')),
    covers: ['embeddings-sqlite-dense-test']
  },
  {
    label: 'embedding-batch-multipliers-test',
    run: () => runNode('embedding-batch-multipliers-test', path.join(root, 'tests', 'embedding-batch-multipliers.js')),
    covers: ['embedding-batch-multipliers-test']
  },
  {
    label: 'embedding-batch-defaults-test',
    run: () => runNode('embedding-batch-defaults-test', path.join(root, 'tests', 'embedding-batch-defaults.js')),
    covers: ['embedding-batch-defaults-test']
  },
  {
    label: 'embedding-batch-throughput-test',
    run: () => runNode('embedding-batch-throughput-test', path.join(root, 'tests', 'embedding-batch-throughput.js')),
    covers: ['embedding-batch-throughput-test']
  },
  {
    label: 'embedding-queue-defaults-test',
    run: () => runNode('embedding-queue-defaults-test', path.join(root, 'tests', 'embedding-queue-defaults.js')),
    covers: ['embedding-queue-defaults-test']
  },
  {
    label: 'build-embeddings-cache-test',
    run: () => runNode('build-embeddings-cache-test', path.join(root, 'tests', 'build-embeddings-cache.js')),
    covers: ['build-embeddings-cache-test']
  },
  {
    label: 'embedding-batch-autotune-test',
    run: () => runNode('embedding-batch-autotune-test', path.join(root, 'tests', 'embedding-batch-autotune.js')),
    covers: ['embedding-batch-autotune-test']
  }
];
