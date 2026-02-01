import path from 'node:path';

export const buildSearchActions = ({ root, runNode }) => [
  {
    label: 'retrieval-branch-filter-test',
    run: () => runNode('retrieval-branch-filter-test', path.join(root, 'tests', 'retrieval', 'filters', 'retrieval-branch-filter.test.js')),
    covers: ['retrieval-branch-filter-test']
  },
  {
    label: 'retrieval-backend-policy-test',
    run: () => runNode('retrieval-backend-policy-test', path.join(root, 'tests', 'retrieval', 'backend', 'retrieval-backend-policy.test.js')),
    covers: ['retrieval-backend-policy-test']
  },
  {
    label: 'churn-filter-test',
    run: () => runNode('churn-filter-test', path.join(root, 'tests', 'retrieval', 'filters', 'churn-filter.test.js')),
    covers: ['churn-filter-test']
  },
  {
    label: 'search-filters-test',
    run: () => runNode('search-filters-test', path.join(root, 'tests', 'retrieval', 'filters', 'behavioral.test.js')),
    covers: ['search-filters-test']
  },
  {
    label: 'structural-search-test',
    run: () => runNode('structural-search-test', path.join(root, 'tests', 'tooling', 'structural', 'structural-search.test.js')),
    covers: ['structural-search-test']
  },
  {
    label: 'structural-filters-test',
    run: () => runNode('structural-filters-test', path.join(root, 'tests', 'tooling', 'structural', 'structural-filters.test.js')),
    covers: ['structural-filters-test']
  },
  {
    label: 'lang-filter-test',
    run: () => runNode('lang-filter-test', path.join(root, 'tests', 'retrieval', 'filters', 'lang-filter.test.js')),
    covers: ['lang-filter-test']
  },
  {
    label: 'filter-index-artifact-test',
    run: () => runNode('filter-index-artifact-test', path.join(root, 'tests', 'retrieval', 'filters', 'filter-index-artifact.test.js')),
    covers: ['filter-index-artifact-test']
  },
  {
    label: 'search-symbol-boost-test',
    run: () => runNode('search-symbol-boost-test', path.join(root, 'tests', 'cli', 'search', 'search-symbol-boost.test.js')),
    covers: ['search-symbol-boost-test']
  },
  {
    label: 'ext-filter-test',
    run: () => runNode('ext-filter-test', path.join(root, 'tests', 'retrieval', 'filters', 'ext-filter.test.js')),
    covers: ['ext-filter-test']
  },
  {
    label: 'filter-strictness-test',
    run: () => runNode('filter-strictness-test', path.join(root, 'tests', 'retrieval', 'filters', 'filter-strictness.test.js')),
    covers: ['filter-strictness-test']
  },
  {
    label: 'filter-index-test',
    run: () => runNode('filter-index-test', path.join(root, 'tests', 'retrieval', 'filters', 'filter-index.test.js')),
    covers: ['filter-index-test']
  },
  {
    label: 'search-missing-index-test',
    run: () => runNode('search-missing-index-test', path.join(root, 'tests', 'cli', 'search', 'search-missing-index.test.js')),
    covers: ['search-missing-index-test']
  },
  {
    label: 'search-help-test',
    run: () => runNode('search-help-test', path.join(root, 'tests', 'cli', 'search', 'search-help.test.js')),
    covers: ['search-help-test']
  },
  {
    label: 'search-removed-flags-test',
    run: () => runNode('search-removed-flags-test', path.join(root, 'tests', 'cli', 'search', 'search-removed-flags.test.js')),
    covers: []
  },
  {
    label: 'search-missing-flag-values-test',
    run: () => runNode('search-missing-flag-values-test', path.join(root, 'tests', 'cli', 'search', 'search-missing-flag-values.test.js')),
    covers: []
  },
  {
    label: 'search-windows-path-filter-test',
    run: () => runNode('search-windows-path-filter-test', path.join(root, 'tests', 'cli', 'search', 'search-windows-path-filter.test.js')),
    covers: []
  },
  {
    label: 'search-explain-symbol-test',
    run: () => runNode('search-explain-symbol-test', path.join(root, 'tests', 'cli', 'search', 'search-explain-symbol.test.js')),
    covers: []
  },
  {
    label: 'query-intent-test',
    run: () => runNode('query-intent-test', path.join(root, 'tests', 'retrieval', 'query', 'query-intent.test.js')),
    covers: ['query-intent-test']
  },
  {
    label: 'context-expansion-test',
    run: () => runNode('context-expansion-test', path.join(root, 'tests', 'retrieval', 'context', 'context-expansion.test.js')),
    covers: ['context-expansion-test']
  },
  {
    label: 'query-cache-test',
    run: () => runNode('query-cache-test', path.join(root, 'tests', 'retrieval', 'cache', 'query-cache.test.js')),
    covers: ['query-cache-test']
  },
  {
    label: 'fielded-bm25-test',
    run: () => runNode('fielded-bm25-test', path.join(root, 'tests', 'retrieval', 'ranking', 'fielded-bm25.test.js')),
    covers: ['fielded-bm25-test']
  }
];
