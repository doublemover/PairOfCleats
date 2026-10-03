import path from 'node:path';

export const buildSearchActions = ({ root, runNode }) => [
  {
    label: 'search-filter-contract-matrix-test',
    run: () => runNode('search-filter-contract-matrix-test', path.join(root, 'tests', 'retrieval', 'filters', 'search-filter-contract-matrix.test.js')),
    covers: [
      'retrieval-branch-filter-test',
      'churn-filter-test',
      'search-filters-test',
      'lang-filter-test',
      'ext-filter-test',
      'filter-strictness-test',
      'filter-index-test',
      'search-filter-contract-matrix-test'
    ]
  },
  {
    label: 'backend-contract-matrix-test',
    run: () => runNode('backend-contract-matrix-test', path.join(root, 'tests', 'retrieval', 'backend', 'backend-contract-matrix.test.js')),
    covers: ['retrieval-backend-policy-test', 'backend-contract-matrix-test']
  },
  {
    label: 'structural-search-test',
    run: () => runNode('structural-search-test', path.join(root, 'tests', 'tooling', 'structural', 'search.test.js')),
    covers: ['structural-search-test']
  },
  {
    label: 'structural-filters-test',
    run: () => runNode('structural-filters-test', path.join(root, 'tests', 'tooling', 'structural', 'filters.test.js')),
    covers: ['structural-filters-test']
  },
  {
    label: 'filter-index-artifact-test',
    run: () => runNode('filter-index-artifact-test', path.join(root, 'tests', 'retrieval', 'filters', 'filter-index-artifact.test.js')),
    covers: ['filter-index-artifact-test']
  },
  {
    label: 'search-symbol-boost-test',
    run: () => runNode('search-symbol-boost-test', path.join(root, 'tests', 'cli', 'search', 'symbol-boost.test.js')),
    covers: ['search-symbol-boost-test']
  },
  {
    label: 'cli-search-contract-matrix-test',
    run: () => runNode('cli-search-contract-matrix-test', path.join(root, 'tests', 'cli', 'search', 'contract-matrix.test.js')),
    covers: [
      'search-missing-index-test',
      'search-help-test',
      'search-removed-flags-test',
      'search-missing-flag-values-test',
      'search-windows-path-filter-test',
      'search-explain-symbol-test',
      'cli-search-contract-matrix-test'
    ]
  },
  {
    label: 'query-contract-matrix-test',
    run: () => runNode('query-contract-matrix-test', path.join(root, 'tests', 'retrieval', 'query', 'query-contract-matrix.test.js')),
    covers: ['query-intent-test', 'query-contract-matrix-test']
  },
  {
    label: 'context-expansion-contract-matrix-test',
    run: () => runNode('context-expansion-contract-matrix-test', path.join(root, 'tests', 'retrieval', 'context-expansion', 'context-expansion-contract-matrix.test.js')),
    covers: ['context-expansion-test', 'context-expansion-contract-matrix-test']
  },
  {
    label: 'query-cache-contract-matrix-test',
    run: () => runNode('query-cache-contract-matrix-test', path.join(root, 'tests', 'retrieval', 'cache', 'query-cache-contract-matrix.test.js')),
    covers: ['query-cache-test', 'query-cache-contract-matrix-test']
  },
  {
    label: 'fielded-bm25-test',
    run: () => runNode('fielded-bm25-test', path.join(root, 'tests', 'retrieval', 'ranking', 'fielded-bm25.test.js')),
    covers: ['fielded-bm25-test']
  }
];
