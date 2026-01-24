import path from 'node:path';

export const buildToolActions = ({ root, fixtureRoot, repoEnv, baseCacheRoot, ciOutDir, runNode }) => [
  {
    label: 'summary-report-test',
    run: () => runNode('summary-report-test', path.join(root, 'tests', 'summary-report.js')),
    covers: ['summary-report-test', 'summary-report']
  },
  {
    label: 'repometrics-dashboard-test',
    run: () => runNode('repometrics-dashboard-test', path.join(root, 'tests', 'repometrics-dashboard.js')),
    covers: ['repometrics-dashboard-test', 'repometrics-dashboard']
  },
  {
    label: 'index-validate-test',
    run: () => runNode('index-validate-test', path.join(root, 'tests', 'index-validate.js')),
    covers: ['index-validate-test', 'index-validate']
  },
  {
    label: 'triage-test',
    run: () => runNode('triage-test', path.join(root, 'tests', 'tooling', 'triage', 'records-index-and-search.test.js')),
    covers: ['triage-test']
  },
  {
    label: 'ctags-ingest-test',
    run: () => runNode('ctags-ingest-test', path.join(root, 'tests', 'ctags-ingest.js')),
    covers: ['ctags-ingest-test']
  },
  {
    label: 'scip-ingest-test',
    run: () => runNode('scip-ingest-test', path.join(root, 'tests', 'scip-ingest.js')),
    covers: ['scip-ingest-test']
  },
  {
    label: 'lsif-ingest-test',
    run: () => runNode('lsif-ingest-test', path.join(root, 'tests', 'lsif-ingest.js')),
    covers: ['lsif-ingest-test']
  },
  {
    label: 'gtags-ingest-test',
    run: () => runNode('gtags-ingest-test', path.join(root, 'tests', 'gtags-ingest.js')),
    covers: ['gtags-ingest-test']
  },
  {
    label: 'vscode-extension-test',
    run: () => runNode('vscode-extension-test', path.join(root, 'tests', 'vscode-extension.js')),
    covers: ['vscode-extension-test']
  },
  {
    label: 'repo-root-test',
    run: () => runNode('repo-root-test', path.join(root, 'tests', 'repo-root.js')),
    covers: ['repo-root-test']
  },
  {
    label: 'tool-root-test',
    run: () => runNode('tool-root-test', path.join(root, 'tests', 'tool-root.js')),
    covers: ['tool-root-test']
  },
  {
    label: 'jsonrpc-parser-test',
    run: () => runNode('jsonrpc-parser-test', path.join(root, 'tests', 'jsonrpc-parser.js')),
    covers: ['jsonrpc-parser-test']
  },
  {
    label: 'index-cache-test',
    run: () => runNode('index-cache-test', path.join(root, 'tests', 'index-cache.js')),
    covers: ['index-cache-test']
  },
  {
    label: 'worker-pool-test',
    run: () => runNode('worker-pool-test', path.join(root, 'tests', 'worker-pool.js')),
    covers: ['worker-pool-test']
  },
  {
    label: 'worker-pool-windows-test',
    run: () => runNode('worker-pool-windows-test', path.join(root, 'tests', 'worker-pool-windows.js')),
    covers: ['worker-pool-windows-test']
  },
  {
    label: 'repo-build-index',
    run: () => runNode('build-index', path.join(root, 'build_index.js'), ['--stub-embeddings', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['build-index']
  },
  {
    label: 'build-index-all-test',
    run: () => runNode('build-index-all-test', path.join(root, 'tests', 'build-index-all.js')),
    covers: ['build-index-all-test']
  },
  {
    label: 'repo-build-sqlite-index',
    run: () => runNode('build-sqlite-index', path.join(root, 'tools', 'build-sqlite-index.js'), ['--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['build-sqlite-index']
  },
  {
    label: 'parity',
    run: () => runNode(
      'parity',
      path.join(root, 'tests', 'parity.js'),
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
    run: () => runNode('report-artifacts', path.join(root, 'tools', 'report-artifacts.js'), ['--json', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['report-artifacts']
  },
  {
    label: 'cache-gc-test',
    run: () => runNode('cache-gc-test', path.join(root, 'tests', 'cache-gc.js')),
    covers: ['cache-gc', 'cache-gc-test']
  },
  {
    label: 'cache-lru-test',
    run: () => runNode('cache-lru-test', path.join(root, 'tests', 'cache-lru.js')),
    covers: ['cache-lru-test']
  },
  {
    label: 'discover-test',
    run: () => runNode('discover-test', path.join(root, 'tests', 'discover.js')),
    covers: ['discover-test']
  },
  {
    label: 'watch-debounce-test',
    run: () => runNode('watch-debounce-test', path.join(root, 'tests', 'watch-debounce.js')),
    covers: ['watch-debounce-test']
  },
  {
    label: 'watch-backend-selection-test',
    run: () => runNode('watch-backend-selection-test', path.join(root, 'tests', 'watch-backend-selection.js')),
    covers: ['watch-backend-selection-test']
  },
  {
    label: 'watch-stability-guard-test',
    run: () => runNode('watch-stability-guard-test', path.join(root, 'tests', 'watch-stability-guard.js')),
    covers: ['watch-stability-guard-test']
  },
  {
    label: 'watch-filter-test',
    run: () => runNode('watch-filter-test', path.join(root, 'tests', 'watch-filter.js')),
    covers: ['watch-filter-test']
  },
  {
    label: 'generate-repo-dict',
    run: () => runNode('generate-repo-dict', path.join(root, 'tools', 'generate-repo-dict.js'), ['--min-count', '1', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['generate-repo-dict']
  },
  {
    label: 'ci-build',
    run: () => runNode('ci-build', path.join(root, 'tools', 'ci-build-artifacts.js'), ['--out', ciOutDir || path.join(baseCacheRoot, 'ci-artifacts'), '--skip-build', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['ci-build']
  },
  {
    label: 'ci-restore',
    run: () => runNode('ci-restore', path.join(root, 'tools', 'ci-restore-artifacts.js'), ['--from', ciOutDir || path.join(baseCacheRoot, 'ci-artifacts'), '--force', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['ci-restore']
  },
  {
    label: 'bootstrap',
    run: () => runNode(
      'bootstrap',
      path.join(root, 'tools', 'bootstrap.js'),
      ['--skip-install', '--skip-dicts', '--skip-index', '--skip-artifacts', '--skip-tooling', '--repo', fixtureRoot],
      { cwd: fixtureRoot, env: repoEnv }
    ),
    covers: ['bootstrap']
  },
  {
    label: 'setup-test',
    run: () => runNode('setup-test', path.join(root, 'tests', 'setup.js')),
    covers: ['setup', 'setup-test']
  },
  {
    label: 'setup-index-detection-test',
    run: () => runNode('setup-index-detection-test', path.join(root, 'tests', 'setup-index-detection.js')),
    covers: ['setup-index-detection-test']
  },
  {
    label: 'config-validate-test',
    run: () => runNode('config-validate-test', path.join(root, 'tests', 'config-validate.js')),
    covers: ['config-validate', 'config-validate-test']
  },
  {
    label: 'config-dump-test',
    run: () => runNode('config-dump-test', path.join(root, 'tests', 'config-dump.js')),
    covers: ['config-dump-test']
  },
  {
    label: 'uv-threadpool-env-test',
    run: () => runNode('uv-threadpool-env-test', path.join(root, 'tests', 'uv-threadpool-env.js')),
    covers: ['uv-threadpool-env-test']
  },
  {
    label: 'uv-threadpool-no-override-test',
    run: () => runNode('uv-threadpool-no-override-test', path.join(root, 'tests', 'uv-threadpool-no-override.js')),
    covers: ['uv-threadpool-no-override-test']
  },
  {
    label: 'io-concurrency-cap-test',
    run: () => runNode('io-concurrency-cap-test', path.join(root, 'tests', 'io-concurrency-cap.js')),
    covers: ['io-concurrency-cap-test']
  },
  {
    label: 'backend-policy-test',
    run: () => runNode('backend-policy-test', path.join(root, 'tests', 'backend-policy.js')),
    covers: ['backend-policy-test']
  },
  {
    label: 'dict-adaptive-test',
    run: () => runNode('dict-adaptive-test', path.join(root, 'tests', 'dict-adaptive.js')),
    covers: ['dict-adaptive-test']
  },
  {
    label: 'chargram-guardrails-test',
    run: () => runNode('chargram-guardrails-test', path.join(root, 'tests', 'chargram-guardrails.js')),
    covers: ['chargram-guardrails-test']
  },
  {
    label: 'core-api-test',
    run: () => runNode('core-api-test', path.join(root, 'tests', 'core-api.js')),
    covers: ['core-api-test']
  },
  {
    label: 'script-coverage-harness-test',
    run: () => runNode('script-coverage-harness-test', path.join(root, 'tests', 'script-coverage-harness.js')),
    covers: ['script-coverage-harness-test']
  },
  {
    label: 'cli-test',
    run: () => runNode('cli-test', path.join(root, 'tests', 'cli.js')),
    covers: ['cli-test']
  }
];
