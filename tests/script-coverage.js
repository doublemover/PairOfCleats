#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
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

function run(label, cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
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
    label: 'language-fidelity-test',
    run: () => runNode('language-fidelity-test', path.join(root, 'tests', 'language-fidelity.js')),
    covers: ['language-fidelity-test']
  },
  {
    label: 'type-inference-crossfile-test',
    run: () => runNode('type-inference-crossfile-test', path.join(root, 'tests', 'type-inference-crossfile.js')),
    covers: ['type-inference-crossfile-test']
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
    label: 'type-inference-lsp-enrichment-test',
    run: () => runNode('type-inference-lsp-enrichment-test', path.join(root, 'tests', 'type-inference-lsp-enrichment.js')),
    covers: ['type-inference-lsp-enrichment-test']
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
    label: 'tokenize-dictionary-test',
    run: () => runNode('tokenize-dictionary-test', path.join(root, 'tests', 'tokenize-dictionary.js')),
    covers: []
  },
  {
    label: 'bench-dict-seg',
    run: () => runNode('bench-dict-seg', path.join(root, 'tools', 'bench-dict-seg.js'), ['--json', '--sample', '80']),
    covers: ['bench-dict-seg']
  },
  {
    label: 'bench-score-strategy',
    run: () => runNode('bench-score-strategy', path.join(root, 'tools', 'bench-score-strategy.js'), ['--json', '--build', '--stub-embeddings', '--limit', '5']),
    covers: ['bench-score-strategy']
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
    label: 'compare-models-test',
    run: () => runNode('compare-models-test', path.join(root, 'tests', 'compare-models.js')),
    covers: ['compare-models-test', 'compare-models']
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
    label: 'fixture-parity',
    run: () => runNode('fixture-parity', path.join(root, 'tests', 'fixture-parity.js')),
    covers: ['fixture-parity']
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
