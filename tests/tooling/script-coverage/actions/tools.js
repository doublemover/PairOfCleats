import path from 'node:path';

export const buildToolActions = ({ root, fixtureRoot, repoEnv, baseCacheRoot, ciOutDir, runNode }) => [
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
  ...['code', 'prose', 'extracted-prose', 'records'].map(mode => ({
    label: `repo-build-index-${mode}`,
    run: async () => {
      const startedAt = Date.now();
      const result = await runNode(`build-index-${mode}`, path.join(root, 'build_index.js'),
        ['--mode', mode, '--stub-embeddings', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv });
      // Inventory-only harnesses record the invocation without executing it.
      if (mode === 'code' && result?.status === 'passed') {
        const { withTemporaryEnv } = await import('../../../helpers/test-env.js');
        const { assertDefaultToolingDiagnostics } = await import('../../../helpers/default-tooling-diagnostics.js');
        const { getRepoCacheRoot } = await import('../../../../src/shared/repo-paths.js');
        const { loadUserConfig } = await import('../../../../tools/shared/dict-utils.js');
        await withTemporaryEnv({ PAIROFCLEATS_CACHE_ROOT: repoEnv.PAIROFCLEATS_CACHE_ROOT,
          PAIROFCLEATS_TEST_CONFIG: repoEnv.PAIROFCLEATS_TEST_CONFIG }, async () => {
          await assertDefaultToolingDiagnostics({ repoCacheRoot: getRepoCacheRoot(fixtureRoot, loadUserConfig(fixtureRoot)), startedAt });
        });
      }
      return result;
    },
    covers: ['build-index']
  })),
  {
    label: 'parity',
    run: () => runNode(
      'parity',
      path.join(root, 'tests', 'retrieval', 'parity', 'equivalence.test.js'),
      ['--search', path.join(root, 'search.js'), '--no-ann', '--repo', fixtureRoot],
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
    covers: []
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
    covers: []
  },
  {
    label: 'env-check-help',
    run: () => runNode('env:check', path.join(root, 'tools', 'ci', 'check-env-usage.js'), ['--help']),
    covers: []
  },
  {
    label: 'config-budget-check',
    run: () => runNode('config:budget', path.join(root, 'tools/config/inventory.js'), ['--check']),
    covers: ['config:budget']
  },
  {
    label: 'env-check',
    run: () => runNode('env:check', path.join(root, 'tools/ci/check-env-usage.js')),
    covers: ['env:check']
  },
  {
    label: 'release-check-help',
    run: () => runNode('release-check', path.join(root, 'tools', 'release', 'check.js'), ['--help']),
    covers: ['release-check']
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
    label: 'import-resolution-slo-gate-help',
    run: () => runNode(
      'import-resolution-slo-gate',
      path.join(root, 'tools', 'ci', 'import-resolution-slo-gate.js'),
      ['--help']
    ),
    covers: ['import-resolution-slo-gate']
  },
  {
    label: 'shard-census-help',
    run: () => runNode('shard-census', path.join(root, 'tools', 'index', 'shard-census.js'), ['--help']),
    covers: ['shard-census']
  }
];
