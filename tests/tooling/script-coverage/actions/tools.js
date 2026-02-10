import path from 'node:path';

export const buildToolActions = ({ root, fixtureRoot, repoEnv, baseCacheRoot, ciOutDir, runNode }) => [
  {
    label: 'summary-report-test',
    run: () => runNode('summary-report-test', path.join(root, 'tests', 'tooling', 'reports', 'summary', 'summary-report.test.js')),
    covers: ['summary-report-test', 'summary-report']
  },
  {
    label: 'metrics-dashboard-test',
    run: () => runNode('metrics-dashboard-test', path.join(root, 'tests', 'tooling', 'reports', 'metrics-dashboard.test.js')),
    covers: ['metrics-dashboard-test', 'metrics-dashboard']
  },
  {
    label: 'index-validate-test',
    run: () => runNode('index-validate-test', path.join(root, 'tests', 'indexing', 'validate', 'index-validate.test.js')),
    covers: ['index-validate-test', 'index-validate']
  },
  {
    label: 'triage-test',
    run: () => runNode('triage-test', path.join(root, 'tests', 'tooling', 'triage', 'records-index-and-search.test.js')),
    covers: ['triage-test']
  },
  {
    label: 'ctags-ingest-test',
    run: () => runNode('ctags-ingest-test', path.join(root, 'tests', 'tooling', 'ingest', 'ctags', 'ctags-ingest.test.js')),
    covers: ['ctags-ingest-test']
  },
  {
    label: 'scip-ingest-test',
    run: () => runNode('scip-ingest-test', path.join(root, 'tests', 'tooling', 'ingest', 'scip', 'scip-ingest.test.js')),
    covers: ['scip-ingest-test']
  },
  {
    label: 'lsif-ingest-test',
    run: () => runNode('lsif-ingest-test', path.join(root, 'tests', 'tooling', 'ingest', 'lsif', 'lsif-ingest.test.js')),
    covers: ['lsif-ingest-test']
  },
  {
    label: 'gtags-ingest-test',
    run: () => runNode('gtags-ingest-test', path.join(root, 'tests', 'tooling', 'ingest', 'gtags', 'gtags-ingest.test.js')),
    covers: ['gtags-ingest-test']
  },
  {
    label: 'ctags-ingest-help',
    run: () => runNode('ctags-ingest', path.join(root, 'tools', 'ingest', 'ctags.js'), ['--help']),
    covers: ['ctags-ingest']
  },
  {
    label: 'scip-ingest-help',
    run: () => runNode('scip-ingest', path.join(root, 'tools', 'ingest', 'scip.js'), ['--help']),
    covers: ['scip-ingest']
  },
  {
    label: 'lsif-ingest-help',
    run: () => runNode('lsif-ingest', path.join(root, 'tools', 'ingest', 'lsif.js'), ['--help']),
    covers: ['lsif-ingest']
  },
  {
    label: 'gtags-ingest-help',
    run: () => runNode('gtags-ingest', path.join(root, 'tools', 'ingest', 'gtags.js'), ['--help']),
    covers: ['gtags-ingest']
  },
  {
    label: 'vscode-extension-test',
    run: () => runNode('vscode-extension-test', path.join(root, 'tests', 'tooling', 'vscode', 'vscode-extension.test.js')),
    covers: ['vscode-extension-test']
  },
  {
    label: 'repo-root-test',
    run: () => runNode('repo-root-test', path.join(root, 'tests', 'cli', 'general', 'repo-root.test.js')),
    covers: ['repo-root-test']
  },
  {
    label: 'tool-root-test',
    run: () => runNode('tool-root-test', path.join(root, 'tests', 'tooling', 'install', 'tool-root.test.js')),
    covers: ['tool-root-test']
  },
  {
    label: 'jsonrpc-parser-test',
    run: () => runNode('jsonrpc-parser-test', path.join(root, 'tests', 'shared', 'jsonrpc', 'jsonrpc-parser.test.js')),
    covers: ['jsonrpc-parser-test']
  },
  {
    label: 'index-cache-test',
    run: () => runNode('index-cache-test', path.join(root, 'tests', 'retrieval', 'cache', 'index-cache.test.js')),
    covers: ['index-cache-test']
  },
  {
    label: 'worker-pool-test',
    run: () => runNode('worker-pool-test', path.join(root, 'tests', 'indexing', 'workers', 'worker-pool.test.js')),
    covers: ['worker-pool-test']
  },
  {
    label: 'worker-pool-windows-test',
    run: () => runNode('worker-pool-windows-test', path.join(root, 'tests', 'indexing', 'workers', 'worker-pool-windows.test.js')),
    covers: ['worker-pool-windows-test']
  },
  {
    label: 'repo-build-index',
    run: () => runNode('build-index', path.join(root, 'build_index.js'), ['--stub-embeddings', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['build-index']
  },
  {
    label: 'build-index-all-test',
    run: () => runNode('build-index-all-test', path.join(root, 'tests', 'cli', 'build-index', 'build-index-all.test.js')),
    covers: ['build-index-all-test']
  },
  {
    label: 'parity',
    run: () => runNode(
      'parity',
      path.join(root, 'tests', 'retrieval', 'parity', 'parity.test.js'),
      ['--search', path.join(root, 'search.js'), '--no-ann'],
      { cwd: fixtureRoot, env: repoEnv }
    ),
    covers: ['parity']
  },
  {
    label: 'repo-search',
    run: () => runNode('search', path.join(root, 'search.js'), ['message', '--json', '--no-ann', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['search']
  },
  {
    label: 'report-artifacts',
    run: () => runNode('report-artifacts', path.join(root, 'tools', 'index', 'report-artifacts.js'), ['--json', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['report-artifacts']
  },
  {
    label: 'cache-gc-test',
    run: () => runNode('cache-gc-test', path.join(root, 'tests', 'shared', 'cache', 'cache-gc.test.js')),
    covers: ['cache-gc', 'cache-gc-test']
  },
  {
    label: 'cache-lru-test',
    run: () => runNode('cache-lru-test', path.join(root, 'tests', 'shared', 'cache', 'cache-lru.test.js')),
    covers: ['cache-lru-test']
  },
  {
    label: 'discover-test',
    run: () => runNode('discover-test', path.join(root, 'tests', 'indexing', 'discovery', 'discover.test.js')),
    covers: ['discover-test']
  },
  {
    label: 'watch-debounce-test',
    run: () => runNode('watch-debounce-test', path.join(root, 'tests', 'indexing', 'watch', 'watch-debounce.test.js')),
    covers: ['watch-debounce-test']
  },
  {
    label: 'watch-backend-selection-test',
    run: () => runNode('watch-backend-selection-test', path.join(root, 'tests', 'indexing', 'watch', 'watch-backend-selection.test.js')),
    covers: ['watch-backend-selection-test']
  },
  {
    label: 'watch-stability-guard-test',
    run: () => runNode('watch-stability-guard-test', path.join(root, 'tests', 'indexing', 'watch', 'watch-stability-guard.test.js')),
    covers: ['watch-stability-guard-test']
  },
  {
    label: 'watch-filter-test',
    run: () => runNode('watch-filter-test', path.join(root, 'tests', 'indexing', 'watch', 'watch-filter.test.js')),
    covers: ['watch-filter-test']
  },
  {
    label: 'generate-repo-dict',
    run: () => runNode('generate-repo-dict', path.join(root, 'tools', 'dicts', 'generate-repo-dict.js'), ['--min-count', '1', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['generate-repo-dict']
  },
  {
    label: 'ci-build',
    run: () => runNode('ci-build', path.join(root, 'tools', 'ci', 'build-artifacts.js'), ['--out', ciOutDir || path.join(baseCacheRoot, 'ci-artifacts'), '--skip-build', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['ci-build']
  },
  {
    label: 'ci-restore',
    run: () => runNode('ci-restore', path.join(root, 'tools', 'ci', 'restore-artifacts.js'), ['--from', ciOutDir || path.join(baseCacheRoot, 'ci-artifacts'), '--force', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['ci-restore']
  },
  {
    label: 'bootstrap',
    run: () => runNode(
      'bootstrap',
      path.join(root, 'tools', 'setup', 'bootstrap.js'),
      ['--skip-install', '--skip-dicts', '--skip-index', '--skip-artifacts', '--skip-tooling', '--repo', fixtureRoot],
      { cwd: fixtureRoot, env: repoEnv }
    ),
    covers: ['bootstrap']
  },
  {
    label: 'setup-test',
    run: () => runNode('setup-test', path.join(root, 'tests', 'tooling', 'install', 'setup.test.js')),
    covers: ['setup', 'setup-test']
  },
  {
    label: 'setup-index-detection-test',
    run: () => runNode('setup-index-detection-test', path.join(root, 'tests', 'tooling', 'install', 'setup-index-detection.test.js')),
    covers: ['setup-index-detection-test']
  },
  {
    label: 'config-validate-test',
    run: () => runNode('config-validate-test', path.join(root, 'tests', 'tooling', 'config', 'config-validate.test.js')),
    covers: ['config-validate', 'config-validate-test']
  },
  {
    label: 'config-dump-test',
    run: () => runNode('config-dump-test', path.join(root, 'tests', 'tooling', 'config', 'config-dump.test.js')),
    covers: ['config-dump-test']
  },
  {
    label: 'structural-search-help',
    run: () => runNode('structural-search', path.join(root, 'tools', 'analysis', 'structural-search.js'), ['--help']),
    covers: ['structural-search']
  },
  {
    label: 'build-tantivy-index-help',
    run: () => runNode('build-tantivy-index', path.join(root, 'tools', 'build', 'tantivy-index.js'), ['--help']),
    covers: ['build-tantivy-index']
  },
  {
    label: 'map-iso-help',
    run: () => runNode('map-iso', path.join(root, 'tools', 'analysis', 'map-iso-serve.js'), ['--help']),
    covers: ['map-iso']
  },
  {
    label: 'config-dump-help',
    run: () => runNode('config-dump', path.join(root, 'tools', 'config', 'dump.js'), ['--help']),
    covers: ['config-dump']
  },
  {
    label: 'config-reset-help',
    run: () => runNode('config-reset', path.join(root, 'tools', 'config', 'reset.js'), ['--help']),
    covers: ['config-reset']
  },
  {
    label: 'config-budget-help',
    run: () => runNode('config:budget', path.join(root, 'tools', 'config', 'inventory.js'), ['--help']),
    covers: ['config:budget']
  },
  {
    label: 'env-check-help',
    run: () => runNode('env:check', path.join(root, 'tools', 'ci', 'check-env-usage.js'), ['--help']),
    covers: ['env:check']
  },
  {
    label: 'release-check-help',
    run: () => runNode('release-check', path.join(root, 'tools', 'release', 'check.js'), ['--help']),
    covers: ['release-check']
  },
  {
    label: 'release-check-breaking-help',
    run: () => runNode('release-check:breaking', path.join(root, 'tools', 'release', 'check.js'), ['--help']),
    covers: ['release-check:breaking']
  },
  {
    label: 'parity-matrix-help',
    run: () => runNode('parity:matrix', path.join(root, 'tools', 'reports', 'parity-matrix.js'), ['--help']),
    covers: ['parity:matrix']
  },
  {
    label: 'eval-run-help',
    run: () => runNode('eval-run', path.join(root, 'tools', 'eval', 'run.js'), ['--help']),
    covers: ['eval-run']
  },
  {
    label: 'bench-micro-tiny-help',
    run: () => runNode('bench-micro:tiny', path.join(root, 'tools', 'bench', 'micro', 'tinybench.js'), ['--help']),
    covers: ['bench-micro:tiny']
  },
  {
    label: 'bench-queries-help',
    run: () => runNode('bench-queries', path.join(root, 'tools', 'bench', 'query-generator.js'), ['--help']),
    covers: ['bench-queries']
  },
  {
    label: 'show-throughput-help',
    run: () => runNode('show-throughput', path.join(root, 'tools', 'reports', 'show-throughput.js'), ['--help']),
    covers: ['show-throughput']
  },
  {
    label: 'get-last-failure-help',
    run: () => runNode('get-last-failure', path.join(root, 'tools', 'ci', 'get-last-failure.js'), ['--help']),
    covers: ['get-last-failure']
  },
  {
    label: 'shard-census-help',
    run: () => runNode('shard-census', path.join(root, 'tools', 'index', 'shard-census.js'), ['--help']),
    covers: ['shard-census']
  },
  {
    label: 'uv-threadpool-env-test',
    run: () => runNode('uv-threadpool-env-test', path.join(root, 'tests', 'shared', 'runtime', 'uv-threadpool-env.test.js')),
    covers: ['uv-threadpool-env-test']
  },
  {
    label: 'uv-threadpool-no-override-test',
    run: () => runNode('uv-threadpool-no-override-test', path.join(root, 'tests', 'shared', 'runtime', 'uv-threadpool-no-override.test.js')),
    covers: ['uv-threadpool-no-override-test']
  },
  {
    label: 'io-concurrency-cap-test',
    run: () => runNode('io-concurrency-cap-test', path.join(root, 'tests', 'shared', 'concurrency', 'io-concurrency-cap.test.js')),
    covers: ['io-concurrency-cap-test']
  },
  {
    label: 'backend-policy-test',
    run: () => runNode('backend-policy-test', path.join(root, 'tests', 'storage', 'backend', 'backend-policy.test.js')),
    covers: ['backend-policy-test']
  },
  {
    label: 'dict-adaptive-test',
    run: () => runNode('dict-adaptive-test', path.join(root, 'tests', 'tooling', 'dict-utils', 'dict-adaptive.test.js')),
    covers: ['dict-adaptive-test']
  },
  {
    label: 'chargram-guardrails-test',
    run: () => runNode('chargram-guardrails-test', path.join(root, 'tests', 'indexing', 'postings', 'chargram-guardrails.test.js')),
    covers: ['chargram-guardrails-test']
  },
  {
    label: 'core-api-test',
    run: () => runNode('core-api-test', path.join(root, 'tests', 'services', 'api', 'core-api.test.js')),
    covers: ['core-api-test']
  },
  {
    label: 'script-coverage-harness-test',
    run: () => runNode('script-coverage-harness-test', path.join(root, 'tests', 'tooling', 'script-coverage', 'script-coverage-harness.test.js')),
    covers: ['script-coverage-harness-test']
  },
  {
    label: 'cli-test',
    run: () => runNode('cli-test', path.join(root, 'tests', 'cli', 'general', 'cli.test.js')),
    covers: ['cli-test']
  }
];
