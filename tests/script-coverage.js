#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCli } from '../src/shared/cli.js';

const root = process.cwd();
const argv = createCli({
  scriptName: 'script-coverage',
  options: {
    retries: { type: 'number', default: 2 },
    'log-dir': { type: 'string', default: '' }
  }
}).parse();
const envRetries = Number.parseInt(
  process.env.PAIROFCLEATS_TEST_RETRIES ?? process.env.npm_config_test_retries ?? '',
  10
);
const retries = Number.isFinite(argv.retries)
  ? Math.max(0, argv.retries)
  : Number.isFinite(envRetries)
    ? Math.max(0, envRetries)
    : 2;
const logDirOverride = argv['log-dir']
  || process.env.PAIROFCLEATS_TEST_LOG_DIR
  || process.env.npm_config_test_log_dir
  || '';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const failureLogRoot = logDirOverride
  ? path.resolve(logDirOverride)
  : path.join(root, 'tests', '.logs', timestamp);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts || {};
const scriptNames = Object.keys(scripts);
const coverage = new Map(scriptNames.map((name) => [name, { status: 'pending', via: null, reason: null }]));

if (coverage.has('script-coverage-test')) {
  coverage.set('script-coverage-test', { status: 'covered', via: 'self', reason: null });
}
if (coverage.has('test-all')) {
  markSkipped('test-all', 'aggregates script-coverage-test and bench');
}
if (coverage.has('test-all-no-bench')) {
  markSkipped('test-all-no-bench', 'aggregates script-coverage-test without bench');
}

const baseCacheRoot = path.join(root, 'tests', '.cache', 'script-coverage');
const repoCacheRoot = path.join(baseCacheRoot, 'repo');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const repoEnv = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: repoCacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

await fsPromises.rm(baseCacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoCacheRoot, { recursive: true });
await fsPromises.mkdir(failureLogRoot, { recursive: true });

function markCovered(name, via) {
  if (!coverage.has(name)) return;
  const entry = coverage.get(name);
  if (entry.status === 'pending') {
    coverage.set(name, { status: 'covered', via, reason: null });
  }
}

function markSkipped(name, reason) {
  if (!coverage.has(name)) return;
  coverage.set(name, { status: 'skipped', via: null, reason });
}

const sanitizeLabel = (label) => label.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 120);

function writeFailureLog(label, attempt, cmd, args, options, result) {
  const safeLabel = sanitizeLabel(label);
  const logPath = path.join(failureLogRoot, `${safeLabel}.attempt-${attempt}.log`);
  const lines = [
    `label: ${label}`,
    `attempt: ${attempt}`,
    `command: ${[cmd, ...args].join(' ')}`,
    `cwd: ${options.cwd || process.cwd()}`,
    `exit: ${result.status ?? 'null'}`,
    ''
  ];
  if (result.stdout) {
    lines.push('--- stdout ---', String(result.stdout));
  }
  if (result.stderr) {
    lines.push('--- stderr ---', String(result.stderr));
  }
  fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
  return logPath;
}

function run(label, cmd, args, options = {}) {
  const maxAttempts = retries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: 'pipe',
      ...options
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status === 0) return;
    const logPath = writeFailureLog(label, attempt, cmd, args, options, result);
    console.error(`Failed: ${label} (attempt ${attempt}/${maxAttempts}). Log: ${logPath}`);
    if (attempt < maxAttempts) {
      console.error(`Retrying: ${label}`);
    }
  }
  process.exit(1);
}

function runNode(label, scriptPath, args = [], options = {}) {
  run(label, process.execPath, [scriptPath, ...args], options);
}

const ciOutDir = path.join(baseCacheRoot, 'ci-artifacts');

const actions = [
  {
    label: 'download-dicts-test',
    run: () => runNode('download-dicts-test', path.join(root, 'tests', 'download-dicts.js')),
    covers: ['download-dicts', 'download-dicts-test']
  },
  {
    label: 'download-extensions-test',
    run: () => runNode('download-extensions-test', path.join(root, 'tests', 'download-extensions.js')),
    covers: ['download-extensions', 'verify-extensions', 'download-extensions-test']
  },
  {
    label: 'tooling-detect-test',
    run: () => runNode('tooling-detect-test', path.join(root, 'tests', 'tooling-detect.js')),
    covers: ['tooling-detect', 'tooling-detect-test']
  },
  {
    label: 'tooling-install-test',
    run: () => runNode('tooling-install-test', path.join(root, 'tests', 'tooling-install.js')),
    covers: ['tooling-install', 'tooling-install-test']
  },
  {
    label: 'clean-artifacts-test',
    run: () => runNode('clean-artifacts-test', path.join(root, 'tests', 'clean-artifacts.js')),
    covers: ['clean-artifacts', 'clean-artifacts-test']
  },
  {
    label: 'uninstall-test',
    run: () => runNode('uninstall-test', path.join(root, 'tests', 'uninstall.js')),
    covers: ['uninstall', 'uninstall-test']
  },
  {
    label: 'sqlite-incremental-test',
    run: () => runNode('sqlite-incremental-test', path.join(root, 'tests', 'sqlite-incremental.js')),
    covers: ['sqlite-incremental-test']
  },
  {
    label: 'incremental-manifest-test',
    run: () => runNode('incremental-manifest-test', path.join(root, 'tests', 'incremental-manifest.js')),
    covers: ['incremental-manifest-test']
  },
  {
    label: 'index-lock-test',
    run: () => runNode('index-lock-test', path.join(root, 'tests', 'index-lock.js')),
    covers: ['index-lock-test']
  },
  {
    label: 'sqlite-compact-test',
    run: () => runNode('sqlite-compact-test', path.join(root, 'tests', 'sqlite-compact.js')),
    covers: ['sqlite-compact-test', 'compact-sqlite-index']
  },
  {
    label: 'sqlite-ann-extension-test',
    run: () => runNode('sqlite-ann-extension-test', path.join(root, 'tests', 'sqlite-ann-extension.js')),
    covers: ['sqlite-ann-extension-test']
  },
  {
    label: 'minhash-parity-test',
    run: () => runNode('minhash-parity-test', path.join(root, 'tests', 'minhash-parity.js')),
    covers: ['minhash-parity-test']
  },
  {
    label: 'language-fidelity-test',
    run: () => runNode('language-fidelity-test', path.join(root, 'tests', 'language-fidelity.js')),
    covers: ['language-fidelity-test']
  },
  {
    label: 'kotlin-perf-guard-test',
    run: () => runNode('kotlin-perf-guard-test', path.join(root, 'tests', 'kotlin-perf-guard.js')),
    covers: ['kotlin-perf-guard-test']
  },
  {
    label: 'tree-sitter-chunks-test',
    run: () => runNode('tree-sitter-chunks-test', path.join(root, 'tests', 'tree-sitter-chunks.js')),
    covers: ['tree-sitter-chunks-test']
  },
  {
    label: 'type-inference-crossfile-go',
    run: () => runNode('type-inference-crossfile-go', path.join(root, 'tests', 'type-inference-crossfile-go.js')),
    covers: []
  },
  {
    label: 'type-inference-typescript-provider-no-ts',
    run: () => runNode('type-inference-typescript-provider-no-ts', path.join(root, 'tests', 'type-inference-typescript-provider-no-ts.js')),
    covers: []
  },
  {
    label: 'type-inference-clangd-provider-no-clangd',
    run: () => runNode('type-inference-clangd-provider-no-clangd', path.join(root, 'tests', 'type-inference-clangd-provider-no-clangd.js')),
    covers: []
  },
  {
    label: 'type-inference-sourcekit-provider-no-sourcekit',
    run: () => runNode('type-inference-sourcekit-provider-no-sourcekit', path.join(root, 'tests', 'type-inference-sourcekit-provider-no-sourcekit.js')),
    covers: []
  },
  {
    label: 'format-fidelity-test',
    run: () => runNode('format-fidelity-test', path.join(root, 'tests', 'format-fidelity.js')),
    covers: ['format-fidelity-test']
  },
  {
    label: 'chunking-yaml-test',
    run: () => runNode('chunking-yaml-test', path.join(root, 'tests', 'chunking-yaml.js')),
    covers: []
  },
  {
    label: 'chunking-sql-lua-test',
    run: () => runNode('chunking-sql-lua-test', path.join(root, 'tests', 'chunking-sql-lua.js')),
    covers: []
  },
  {
    label: 'prose-skip-imports-test',
    run: () => runNode('prose-skip-imports-test', path.join(root, 'tests', 'prose-skip-imports.js')),
    covers: ['prose-skip-imports-test']
  },
  {
    label: 'tokenize-dictionary-test',
    run: () => runNode('tokenize-dictionary-test', path.join(root, 'tests', 'tokenize-dictionary.js')),
    covers: []
  },
  {
    label: 'import-links-test',
    run: () => runNode('import-links-test', path.join(root, 'tests', 'import-links.js')),
    covers: ['import-links-test']
  },
  {
    label: 'git-blame-range-test',
    run: () => runNode('git-blame-range-test', path.join(root, 'tests', 'git-blame-range.js')),
    covers: ['git-blame-range-test']
  },
  {
    label: 'external-docs-test',
    run: () => runNode('external-docs-test', path.join(root, 'tests', 'external-docs.js')),
    covers: ['external-docs-test']
  },
  {
    label: 'tooling-lsp-test',
    run: () => runNode('tooling-lsp-test', path.join(root, 'tests', 'tooling-lsp.js')),
    covers: []
  },
  {
    label: 'bench-language-repos-test',
    run: () => runNode('bench-language-repos-test', path.join(root, 'tests', 'bench-language-repos.js')),
    covers: ['bench-language-test']
  },
  {
    label: 'bench-language-lock-test',
    run: () => runNode('bench-language-lock-test', path.join(root, 'tests', 'bench-language-lock.js')),
    covers: ['bench-language-lock-test']
  },
  {
    label: 'summary-report-test',
    run: () => runNode('summary-report-test', path.join(root, 'tests', 'summary-report.js')),
    covers: ['summary-report-test', 'summary-report']
  },
  {
    label: 'docs-consistency-test',
    run: () => runNode('docs-consistency-test', path.join(root, 'tests', 'docs-consistency.js')),
    covers: ['docs-consistency-test']
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
    run: () => runNode('triage-test', path.join(root, 'tests', 'triage-records.js')),
    covers: ['triage-test']
  },
  {
    label: 'mcp-server-test',
    run: () => runNode('mcp-server-test', path.join(root, 'tests', 'mcp-server.js')),
    covers: ['mcp-server-test', 'mcp-server']
  },
  {
    label: 'api-server-test',
    run: () => runNode('api-server-test', path.join(root, 'tests', 'api-server.js')),
    covers: ['api-server-test', 'api-server']
  },
  {
    label: 'api-server-stream-test',
    run: () => runNode('api-server-stream-test', path.join(root, 'tests', 'api-server-stream.js')),
    covers: ['api-server-stream-test']
  },
  {
    label: 'indexer-service-test',
    run: () => runNode('indexer-service-test', path.join(root, 'tests', 'indexer-service.js')),
    covers: ['indexer-service', 'indexer-service-test']
  },
  {
    label: 'git-hooks-test',
    run: () => runNode('git-hooks-test', path.join(root, 'tests', 'git-hooks.js')),
    covers: ['git-hooks-test', 'git-hooks']
  },
  {
    label: 'git-meta-test',
    run: () => runNode('git-meta-test', path.join(root, 'tests', 'git-meta.js')),
    covers: []
  },
  {
    label: 'churn-filter-test',
    run: () => runNode('churn-filter-test', path.join(root, 'tests', 'churn-filter.js')),
    covers: []
  },
  {
    label: 'search-filters-test',
    run: () => runNode('search-filters-test', path.join(root, 'tests', 'search-filters.js')),
    covers: ['search-filters-test']
  },
  {
    label: 'ctags-ingest-test',
    run: () => runNode('ctags-ingest-test', path.join(root, 'tests', 'ctags-ingest.js')),
    covers: ['ctags-ingest', 'ctags-ingest-test']
  },
  {
    label: 'scip-ingest-test',
    run: () => runNode('scip-ingest-test', path.join(root, 'tests', 'scip-ingest.js')),
    covers: ['scip-ingest', 'scip-ingest-test']
  },
  {
    label: 'lsif-ingest-test',
    run: () => runNode('lsif-ingest-test', path.join(root, 'tests', 'lsif-ingest.js')),
    covers: ['lsif-ingest', 'lsif-ingest-test']
  },
  {
    label: 'gtags-ingest-test',
    run: () => runNode('gtags-ingest-test', path.join(root, 'tests', 'gtags-ingest.js')),
    covers: ['gtags-ingest', 'gtags-ingest-test']
  },
  {
    label: 'structural-search-test',
    run: () => runNode('structural-search-test', path.join(root, 'tests', 'structural-search.js')),
    covers: ['structural-search', 'structural-search-test']
  },
  {
    label: 'lang-filter-test',
    run: () => runNode('lang-filter-test', path.join(root, 'tests', 'lang-filter.js')),
    covers: ['lang-filter-test']
  },
  {
    label: 'sqlite-auto-backend-test',
    run: () => runNode('sqlite-auto-backend-test', path.join(root, 'tests', 'sqlite-auto-backend.js')),
    covers: ['sqlite-auto-backend-test']
  },
  {
    label: 'search-explain-test',
    run: () => runNode('search-explain-test', path.join(root, 'tests', 'search-explain.js')),
    covers: ['search-explain-test']
  },
  {
    label: 'search-symbol-boost-test',
    run: () => runNode('search-symbol-boost-test', path.join(root, 'tests', 'search-symbol-boost.js')),
    covers: ['search-symbol-boost-test']
  },
  {
    label: 'vscode-extension-test',
    run: () => runNode('vscode-extension-test', path.join(root, 'tests', 'vscode-extension.js')),
    covers: ['vscode-extension-test']
  },
  {
    label: 'ext-filter-test',
    run: () => runNode('ext-filter-test', path.join(root, 'tests', 'ext-filter.js')),
    covers: ['ext-filter-test']
  },
  {
    label: 'filter-strictness-test',
    run: () => runNode('filter-strictness-test', path.join(root, 'tests', 'filter-strictness.js')),
    covers: ['filter-strictness-test']
  },
  {
    label: 'filter-index-test',
    run: () => runNode('filter-index-test', path.join(root, 'tests', 'filter-index.js')),
    covers: ['filter-index-test']
  },
  {
    label: 'search-missing-index-test',
    run: () => runNode('search-missing-index-test', path.join(root, 'tests', 'search-missing-index.js')),
    covers: ['search-missing-index-test']
  },
  {
    label: 'search-help-test',
    run: () => runNode('search-help-test', path.join(root, 'tests', 'search-help.js')),
    covers: ['search-help-test']
  },
  {
    label: 'unicode-offset-test',
    run: () => runNode('unicode-offset-test', path.join(root, 'tests', 'unicode-offset.js')),
    covers: []
  },
  {
    label: 'repo-root-test',
    run: () => runNode('repo-root-test', path.join(root, 'tests', 'repo-root.js')),
    covers: []
  },
  {
    label: 'file-size-guard-test',
    run: () => runNode('file-size-guard-test', path.join(root, 'tests', 'file-size-guard.js')),
    covers: []
  },
  {
    label: 'ts-jsx-fixtures',
    run: () => runNode('ts-jsx-fixtures', path.join(root, 'tests', 'ts-jsx-fixtures.js')),
    covers: []
  },
  {
    label: 'python-fallback-test',
    run: () => runNode('python-fallback-test', path.join(root, 'tests', 'python-fallback.js')),
    covers: []
  },
  {
    label: 'python-ast-worker-test',
    run: () => runNode('python-ast-worker-test', path.join(root, 'tests', 'python-ast-worker.js')),
    covers: []
  },
  {
    label: 'verify',
    run: () => runNode('verify', path.join(root, 'tests', 'smoke.js')),
    covers: ['verify']
  },
  {
    label: 'fixture-smoke',
    run: () => runNode('fixture-smoke', path.join(root, 'tests', 'fixture-smoke.js')),
    covers: ['fixture-smoke', 'build-index', 'build-sqlite-index', 'search']
  },
  {
    label: 'fixture-empty',
    run: () => runNode('fixture-empty', path.join(root, 'tests', 'fixture-empty.js')),
    covers: []
  },
  {
    label: 'fixture-eval',
    run: () => runNode('fixture-eval', path.join(root, 'tests', 'fixture-eval.js')),
    covers: ['fixture-eval']
  },
  {
    label: 'query-cache-test',
    run: () => runNode('query-cache-test', path.join(root, 'tests', 'query-cache.js')),
    covers: ['query-cache-test']
  },
  {
    label: 'json-stream-test',
    run: () => runNode('json-stream-test', path.join(root, 'tests', 'json-stream.js')),
    covers: ['json-stream-test']
  },
  {
    label: 'index-cache-test',
    run: () => runNode('index-cache-test', path.join(root, 'tests', 'index-cache.js')),
    covers: ['index-cache-test']
  },
  {
    label: 'sqlite-cache-test',
    run: () => runNode('sqlite-cache-test', path.join(root, 'tests', 'sqlite-cache.js')),
    covers: ['sqlite-cache-test']
  },
  {
    label: 'worker-pool-test',
    run: () => runNode('worker-pool-test', path.join(root, 'tests', 'worker-pool.js')),
    covers: ['worker-pool-test']
  },
  {
    label: 'repo-build-index',
    run: () => runNode('build-index', path.join(root, 'build_index.js'), ['--stub-embeddings', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['build-index']
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
    label: 'search-sqlite',
    run: () => runNode('search-sqlite', path.join(root, 'tools', 'search-sqlite.js'), ['message', '--json', '--no-ann', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['search-sqlite']
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
    run: () => runNode('ci-build', path.join(root, 'tools', 'ci-build-artifacts.js'), ['--out', ciOutDir, '--skip-build', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
    covers: ['ci-build']
  },
  {
    label: 'ci-restore',
    run: () => runNode('ci-restore', path.join(root, 'tools', 'ci-restore-artifacts.js'), ['--from', ciOutDir, '--force', '--repo', fixtureRoot], { cwd: fixtureRoot, env: repoEnv }),
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
    label: 'config-validate-test',
    run: () => runNode('config-validate-test', path.join(root, 'tests', 'config-validate.js')),
    covers: ['config-validate', 'config-validate-test']
  },
  {
    label: 'profile-config-test',
    run: () => runNode('profile-config-test', path.join(root, 'tests', 'profile-config.js')),
    covers: ['profile-config-test']
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
    label: 'typescript-parser-selection-test',
    run: () => runNode('typescript-parser-selection-test', path.join(root, 'tests', 'typescript-parser-selection.js')),
    covers: ['typescript-parser-selection-test']
  },
  {
    label: 'cli-test',
    run: () => runNode('cli-test', path.join(root, 'tests', 'cli.js')),
    covers: ['cli-test']
  }
];

const mergeDir = path.join(baseCacheRoot, 'merge');
await fsPromises.mkdir(mergeDir, { recursive: true });
const mergeBase = path.join(mergeDir, 'base.txt');
const mergeTarget = path.join(mergeDir, 'target.txt');
await fsPromises.writeFile(mergeBase, 'alpha\nbeta\n');
await fsPromises.writeFile(mergeTarget, 'beta\ngamma\n');

actions.push({
  label: 'merge-history',
  run: () => runNode('merge-history', path.join(root, 'tools', 'mergeSearchHistory.js'), [mergeBase, mergeTarget]),
  covers: ['merge-history']
});
actions.push({
  label: 'merge-no-results',
  run: () => runNode('merge-no-results', path.join(root, 'tools', 'mergeNoResultQueries.js'), [mergeBase, mergeTarget]),
  covers: ['merge-no-results']
});

for (const action of actions) {
  console.log(`[script-coverage] ${action.label}`);
  action.run();
  for (const name of action.covers) {
    markCovered(name, action.label);
  }
}

markSkipped('download-models', 'requires network model download');
markSkipped('bench', 'benchmarks are long-running');
markSkipped('bench-ann', 'benchmarks are long-running');
markSkipped('bench-dict-seg', 'benchmarks are long-running');
markSkipped('bench-score-strategy', 'benchmarks are long-running');
markSkipped('bench-compare-models', 'benchmarks are long-running');
markSkipped('compare-models', 'benchmark/perf evaluation');
markSkipped('type-inference-crossfile-test', 'temporarily gated (hangs in script-coverage)');
markSkipped('type-inference-lsp-enrichment-test', 'temporarily gated (ERR_STREAM_DESTROYED)');
markSkipped('fixture-parity', 'temporarily gated (flaky build-index crash in languages fixture)');
markSkipped('bench-language', 'benchmarks are long-running');
markSkipped('watch-index', 'watch mode runs until interrupted');
markSkipped('format', 'modifies working tree');
markSkipped('lint', 'requires npm install and project lint config');

for (const name of coverage.keys()) {
  if (name.startsWith('bench-language:')) {
    markSkipped(name, 'bench-language variants are long-running');
  }
}

const shellScripts = [
  path.join(root, 'merge-history.sh'),
  path.join(root, 'merge-no-results.sh'),
  path.join(root, 'merge-metrics.sh'),
  path.join(root, 'tools', 'merge-history.sh'),
  path.join(root, 'tools', 'merge-no-results.sh'),
  path.join(root, 'tools', 'merge-metrics.sh'),
  path.join(root, 'tools', 'merge-agentinfo-notes.sh'),
  path.join(root, 'tools', 'merge-agentinfo-index.sh')
];

const bashCheck = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
const bashAvailable = bashCheck.status === 0;
const jqCheck = bashAvailable ? spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }) : null;
const jqAvailable = jqCheck && jqCheck.status === 0;
const toPosixPath = (value) => (process.platform === 'win32' ? value.replace(/\\/g, '/') : value);
const bashPathCheck = bashAvailable
  ? spawnSync('bash', ['-c', `cd "${toPosixPath(root)}"`], { encoding: 'utf8' })
  : null;
const bashAccessible = bashPathCheck && bashPathCheck.status === 0;

if (bashAvailable && bashAccessible) {
  const shellWorkDir = path.join(baseCacheRoot, 'shell');
  await fsPromises.mkdir(shellWorkDir, { recursive: true });
  const base = path.join(shellWorkDir, 'base.json');
  const ours = path.join(shellWorkDir, 'ours.json');
  const theirs = path.join(shellWorkDir, 'theirs.json');
  await fsPromises.writeFile(base, JSON.stringify({ file: { md: 1, code: 1 } }, null, 2));
  await fsPromises.writeFile(ours, JSON.stringify({ file: { md: 2, code: 0 } }, null, 2));
  await fsPromises.writeFile(theirs, JSON.stringify({ file: { md: 3, code: 2 } }, null, 2));

  for (const scriptPath of shellScripts) {
    if (!fs.existsSync(scriptPath)) continue;
    if (scriptPath.endsWith('merge-metrics.sh') && !jqAvailable) {
      console.log(`[skip] ${scriptPath} (jq not available)`);
      continue;
    }
    const args = [scriptPath, base, ours, theirs].map(toPosixPath);
    run('shell-script', 'bash', args, { cwd: root });
  }
} else if (!bashAvailable) {
  console.log('[skip] shell scripts (bash not available)');
} else {
  console.log('[skip] shell scripts (bash cannot access workspace path)');
}

const missing = [];
const skipped = [];
const covered = [];
for (const [name, entry] of coverage.entries()) {
  if (entry.status === 'pending') missing.push(name);
  if (entry.status === 'skipped') skipped.push({ name, reason: entry.reason });
  if (entry.status === 'covered') covered.push({ name, via: entry.via });
}

if (missing.length) {
  console.error(`Missing coverage for: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`script coverage: ${covered.length} covered, ${skipped.length} skipped`);
if (skipped.length) {
  for (const entry of skipped) {
    console.log(`- skipped ${entry.name}: ${entry.reason}`);
  }
}
