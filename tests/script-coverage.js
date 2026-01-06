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
const tierBRequired = new Set(
  ['build-index', 'build-sqlite-index', 'build-lmdb-index', 'compact-sqlite-index']
    .filter((name) => coverage.has(name))
);
const tierBCoverage = new Map(
  Array.from(tierBRequired, (name) => [name, { status: 'pending', via: null, reason: null }])
);

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

function markTierBCovered(name, via) {
  if (!tierBCoverage.has(name)) return;
  const entry = tierBCoverage.get(name);
  if (entry.status === 'pending') {
    tierBCoverage.set(name, { status: 'covered', via, reason: null });
  }
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
  const normalizeOutput = (value) => {
    if (!value) return '';
    let text = String(value);
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/^\n+/, '\n');
    return text;
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { env: optionEnv, ...spawnOptions } = options;
    const env = { ...process.env, ...optionEnv };
    if (!env.PAIROFCLEATS_TEST_LOG_DIR) {
      env.PAIROFCLEATS_TEST_LOG_DIR = failureLogRoot;
    }
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: 'pipe',
      env,
      ...spawnOptions
    });
    if (result.stdout) process.stdout.write(normalizeOutput(result.stdout));
    if (result.stderr) process.stderr.write(normalizeOutput(result.stderr));
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
    label: 'vector-extension-sanitize-test',
    run: () => runNode('vector-extension-sanitize-test', path.join(root, 'tests', 'vector-extension-sanitize.js')),
    covers: ['vector-extension-sanitize-test']
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
    label: 'sqlite-bundle-missing-test',
    run: () => runNode('sqlite-bundle-missing-test', path.join(root, 'tests', 'sqlite-bundle-missing.js')),
    covers: ['sqlite-bundle-missing-test']
  },
  {
    label: 'sqlite-index-state-fail-closed-test',
    run: () => runNode('sqlite-index-state-fail-closed-test', path.join(root, 'tests', 'sqlite-index-state-fail-closed.js')),
    covers: ['sqlite-index-state-fail-closed-test']
  },
  {
    label: 'artifact-size-guardrails-test',
    run: () => runNode('artifact-size-guardrails-test', path.join(root, 'tests', 'artifact-size-guardrails.js')),
    covers: ['artifact-size-guardrails-test']
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
    label: 'hnsw-ann-test',
    run: () => runNode('hnsw-ann-test', path.join(root, 'tests', 'hnsw-ann.js')),
    covers: ['hnsw-ann-test']
  },
  {
    label: 'hnsw-atomic-test',
    run: () => runNode('hnsw-atomic-test', path.join(root, 'tests', 'hnsw-atomic.js')),
    covers: ['hnsw-atomic-test']
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
    label: 'metadata-v2-test',
    run: () => runNode('metadata-v2-test', path.join(root, 'tests', 'metadata-v2.js')),
    covers: ['metadata-v2-test']
  },
  {
    label: 'chunking-limits-test',
    run: () => runNode('chunking-limits-test', path.join(root, 'tests', 'chunking-limits.js')),
    covers: ['chunking-limits-test']
  },
  {
    label: 'graph-chunk-id-test',
    run: () => runNode('graph-chunk-id-test', path.join(root, 'tests', 'graph-chunk-id.js')),
    covers: ['graph-chunk-id-test']
  },
  {
    label: 'sqlite-chunk-id-test',
    run: () => runNode('sqlite-chunk-id-test', path.join(root, 'tests', 'sqlite-chunk-id.js')),
    covers: ['sqlite-chunk-id-test']
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
    label: 'type-inference-crossfile-test',
    run: () => runNode('type-inference-crossfile-test', path.join(root, 'tests', 'type-inference-crossfile.js')),
    covers: ['type-inference-crossfile-test']
  },
  {
    label: 'type-inference-lsp-enrichment-test',
    run: () => runNode('type-inference-lsp-enrichment-test', path.join(root, 'tests', 'type-inference-lsp-enrichment.js')),
    covers: ['type-inference-lsp-enrichment-test']
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
    label: 'segment-pipeline-test',
    run: () => runNode('segment-pipeline-test', path.join(root, 'tests', 'segment-pipeline.js')),
    covers: []
  },
  {
    label: 'prose-skip-imports-test',
    run: () => runNode('prose-skip-imports-test', path.join(root, 'tests', 'prose-skip-imports.js')),
    covers: ['prose-skip-imports-test']
  },
  {
    label: 'extracted-prose-test',
    run: () => runNode('extracted-prose-test', path.join(root, 'tests', 'extracted-prose.js')),
    covers: []
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
    label: 'lsp-shutdown-test',
    run: () => runNode('lsp-shutdown-test', path.join(root, 'tests', 'lsp-shutdown.js')),
    covers: ['lsp-shutdown-test']
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
    label: 'embeddings-validate-test',
    run: () => runNode('embeddings-validate-test', path.join(root, 'tests', 'embeddings-validate.js')),
    covers: ['embeddings-validate-test']
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
    label: 'mcp-schema-test',
    run: () => runNode('mcp-schema-test', path.join(root, 'tests', 'mcp-schema.js')),
    covers: ['mcp-schema-test']
  },
  {
    label: 'mcp-robustness-test',
    run: () => runNode('mcp-robustness-test', path.join(root, 'tests', 'mcp-robustness.js')),
    covers: ['mcp-robustness-test']
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
    label: 'piece-assembly-test',
    run: () => runNode('piece-assembly-test', path.join(root, 'tests', 'piece-assembly.js')),
    covers: ['piece-assembly-test']
  },
  {
    label: 'compact-pieces-test',
    run: () => runNode('compact-pieces-test', path.join(root, 'tests', 'compact-pieces.js')),
    covers: ['compact-pieces-test']
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
    label: 'structural-filters-test',
    run: () => runNode('structural-filters-test', path.join(root, 'tests', 'structural-filters.js')),
    covers: ['structural-filters-test']
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
    label: 'sqlite-missing-dep-test',
    run: () => runNode('sqlite-missing-dep-test', path.join(root, 'tests', 'sqlite-missing-dep.js')),
    covers: ['sqlite-missing-dep-test']
  },
  {
    label: 'search-explain-test',
    run: () => runNode('search-explain-test', path.join(root, 'tests', 'search-explain.js')),
    covers: ['search-explain-test']
  },
  {
    label: 'search-rrf-test',
    run: () => runNode('search-rrf-test', path.join(root, 'tests', 'search-rrf.js')),
    covers: ['search-rrf-test']
  },
  {
    label: 'artifact-bak-recovery-test',
    run: () => runNode('artifact-bak-recovery-test', path.join(root, 'tests', 'artifact-bak-recovery.js')),
    covers: ['artifact-bak-recovery-test']
  },
  {
    label: 'encoding-hash-test',
    run: () => runNode('encoding-hash-test', path.join(root, 'tests', 'encoding-hash.js')),
    covers: ['encoding-hash-test']
  },
  {
    label: 'embeddings-cache-identity-test',
    run: () => runNode('embeddings-cache-identity-test', path.join(root, 'tests', 'embeddings-cache-identity.js')),
    covers: ['embeddings-cache-identity-test']
  },
  {
    label: 'embeddings-dims-mismatch-test',
    run: () => runNode('embeddings-dims-mismatch-test', path.join(root, 'tests', 'embeddings-dims-mismatch.js')),
    covers: ['embeddings-dims-mismatch-test']
  },
  {
    label: 'search-topn-filters-test',
    run: () => runNode('search-topn-filters-test', path.join(root, 'tests', 'search-topn-filters.js')),
    covers: ['search-topn-filters-test']
  },
  {
    label: 'search-determinism-test',
    run: () => runNode('search-determinism-test', path.join(root, 'tests', 'search-determinism.js')),
    covers: ['search-determinism-test']
  },
  {
    label: 'filter-index-artifact-test',
    run: () => runNode('filter-index-artifact-test', path.join(root, 'tests', 'filter-index-artifact.js')),
    covers: ['filter-index-artifact-test']
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
    label: 'search-removed-flags-test',
    run: () => runNode('search-removed-flags-test', path.join(root, 'tests', 'search-removed-flags.js')),
    covers: []
  },
  {
    label: 'search-missing-flag-values-test',
    run: () => runNode('search-missing-flag-values-test', path.join(root, 'tests', 'search-missing-flag-values.js')),
    covers: []
  },
  {
    label: 'search-windows-path-filter-test',
    run: () => runNode('search-windows-path-filter-test', path.join(root, 'tests', 'search-windows-path-filter.js')),
    covers: []
  },
  {
    label: 'search-explain-symbol-test',
    run: () => runNode('search-explain-symbol-test', path.join(root, 'tests', 'search-explain-symbol.js')),
    covers: []
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
    label: 'tool-root-test',
    run: () => runNode('tool-root-test', path.join(root, 'tests', 'tool-root.js')),
    covers: []
  },
  {
    label: 'file-size-guard-test',
    run: () => runNode('file-size-guard-test', path.join(root, 'tests', 'file-size-guard.js')),
    covers: []
  },
  {
    label: 'file-line-guard-test',
    run: () => runNode('file-line-guard-test', path.join(root, 'tests', 'file-line-guard.js')),
    covers: []
  },
  {
    label: 'skip-minified-binary-test',
    run: () => runNode('skip-minified-binary-test', path.join(root, 'tests', 'skip-minified-binary.js')),
    covers: []
  },
  {
    label: 'read-failure-skip-test',
    run: () => runNode('read-failure-skip-test', path.join(root, 'tests', 'read-failure-skip.js')),
    covers: []
  },
  {
    label: 'encoding-fallback-test',
    run: () => runNode('encoding-fallback-test', path.join(root, 'tests', 'encoding-fallback.js')),
    covers: []
  },
  {
    label: 'incremental-tokenization-cache-test',
    run: () => runNode('incremental-tokenization-cache-test', path.join(root, 'tests', 'incremental-tokenization-cache.js')),
    covers: []
  },
  {
    label: 'tokenization-buffering-test',
    run: () => runNode('tokenization-buffering-test', path.join(root, 'tests', 'tokenization-buffering.js')),
    covers: []
  },
  {
    label: 'postings-quantize-test',
    run: () => runNode('postings-quantize-test', path.join(root, 'tests', 'postings-quantize.js')),
    covers: []
  },
  {
    label: 'embedding-batch-multipliers-test',
    run: () => runNode('embedding-batch-multipliers-test', path.join(root, 'tests', 'embedding-batch-multipliers.js')),
    covers: []
  },
  {
    label: 'typescript-imports-only-test',
    run: () => runNode('typescript-imports-only-test', path.join(root, 'tests', 'typescript-imports-only.js')),
    covers: []
  },
  {
    label: 'import-priority-test',
    run: () => runNode('import-priority-test', path.join(root, 'tests', 'import-priority.js')),
    covers: []
  },
  {
    label: 'ignore-overrides-test',
    run: () => runNode('ignore-overrides-test', path.join(root, 'tests', 'ignore-overrides.js')),
    covers: []
  },
  {
    label: 'incremental-cache-signature-test',
    run: () => runNode('incremental-cache-signature-test', path.join(root, 'tests', 'incremental-cache-signature.js')),
    covers: []
  },
  {
    label: 'incremental-reuse-test',
    run: () => runNode('incremental-reuse-test', path.join(root, 'tests', 'incremental-reuse.js')),
    covers: []
  },
  {
    label: 'thread-limits-test',
    run: () => runNode('thread-limits-test', path.join(root, 'tests', 'thread-limits.js')),
    covers: []
  },
  {
    label: 'bench-progress-format-test',
    run: () => runNode('bench-progress-format-test', path.join(root, 'tests', 'bench-progress-format.js')),
    covers: []
  },
  {
    label: 'shard-merge-test',
    run: () => runNode('shard-merge-test', path.join(root, 'tests', 'shard-merge.js')),
    covers: []
  },
  {
    label: 'shard-plan-test',
    run: () => runNode('shard-plan-test', path.join(root, 'tests', 'shard-plan.js')),
    covers: []
  },
  {
    label: 'preprocess-files-test',
    run: () => runNode('preprocess-files-test', path.join(root, 'tests', 'preprocess-files.js')),
    covers: []
  },
  {
    label: 'service-queue-test',
    run: () => runNode('service-queue-test', path.join(root, 'tests', 'service-queue.js')),
    covers: []
  },
  {
    label: 'build-embeddings-cache-test',
    run: () => runNode('build-embeddings-cache-test', path.join(root, 'tests', 'build-embeddings-cache.js')),
    covers: []
  },
  {
    label: 'embedding-batch-autotune-test',
    run: () => runNode('embedding-batch-autotune-test', path.join(root, 'tests', 'embedding-batch-autotune.js')),
    covers: []
  },
  {
    label: 'sqlite-build-indexes-test',
    run: () => runNode('sqlite-build-indexes-test', path.join(root, 'tests', 'sqlite-build-indexes.js')),
    covers: []
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
    covers: ['fixture-smoke', 'build-index', 'build-sqlite-index', 'search'],
    coversTierB: ['build-index', 'build-sqlite-index']
  },
  {
    label: 'fixture-parity',
    run: () => runNode('fixture-parity', path.join(root, 'tests', 'fixture-parity.js'), ['--fixtures', 'sample']),
    covers: ['fixture-parity']
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
    label: 'eval-quality-test',
    run: () => runNode('eval-quality-test', path.join(root, 'tests', 'eval-quality.js')),
    covers: ['eval-quality-test', 'eval-run']
  },
  {
    label: 'fielded-bm25-test',
    run: () => runNode('fielded-bm25-test', path.join(root, 'tests', 'fielded-bm25.js')),
    covers: ['fielded-bm25-test']
  },
  {
    label: 'artifact-formats-test',
    run: () => runNode('artifact-formats-test', path.join(root, 'tests', 'artifact-formats.js')),
    covers: ['artifact-formats-test']
  },
  {
    label: 'query-intent-test',
    run: () => runNode('query-intent-test', path.join(root, 'tests', 'query-intent.js')),
    covers: ['query-intent-test']
  },
  {
    label: 'context-expansion-test',
    run: () => runNode('context-expansion-test', path.join(root, 'tests', 'context-expansion.js')),
    covers: ['context-expansion-test']
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
  label: 'merge-append',
  run: () => runNode('merge-append', path.join(root, 'tools', 'mergeAppendOnly.js'), [mergeBase, mergeTarget]),
  covers: ['merge-append']
});

for (const action of actions) {
  console.log(`[script-coverage] ${action.label}`);
  action.run();
  for (const name of action.covers) {
    markCovered(name, action.label);
  }
  if (Array.isArray(action.coversTierB)) {
    for (const name of action.coversTierB) {
      markTierBCovered(name, action.label);
    }
  }
}

markSkipped('download-models', 'requires network model download');
markSkipped('bench', 'benchmarks are long-running');
markSkipped('bench-ann', 'benchmarks are long-running');
markSkipped('bench-dict-seg', 'benchmarks are long-running');
markSkipped('bench-score-strategy', 'benchmarks are long-running');
markSkipped('bench-micro', 'benchmarks are long-running');
markSkipped('compare-models', 'benchmark/perf evaluation');
markSkipped('bench-language', 'benchmarks are long-running');
markSkipped('smoke:section1', 'smoke lanes are run manually');
markSkipped('smoke:retrieval', 'smoke lanes are run manually');
markSkipped('smoke:services', 'smoke lanes are run manually');
markSkipped('smoke:workers', 'smoke lanes are run manually');
markSkipped('smoke:embeddings', 'smoke lanes are run manually');
markSkipped('smoke:sqlite', 'smoke lanes are run manually');
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

const missingTierB = [];
const coveredTierB = [];
for (const [name, entry] of tierBCoverage.entries()) {
  if (entry.status === 'pending') missingTierB.push(name);
  if (entry.status === 'covered') coveredTierB.push({ name, via: entry.via });
}

if (missing.length || missingTierB.length) {
  if (missing.length) {
    console.error(`Missing coverage for: ${missing.join(', ')}`);
  }
  if (missingTierB.length) {
    console.error(`Missing Tier B coverage for: ${missingTierB.join(', ')}`);
  }
  process.exit(1);
}

console.log(`script coverage: ${covered.length} covered, ${skipped.length} skipped`);
console.log(`tier B coverage: ${coveredTierB.length} covered, ${missingTierB.length} missing`);
if (skipped.length) {
  for (const entry of skipped) {
    console.log(`- skipped ${entry.name}: ${entry.reason}`);
  }
}
