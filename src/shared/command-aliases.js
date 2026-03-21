import { describeCommandRegistryEntry } from './command-registry.js';

const aliasEntry = (name, replacement) => Object.freeze({
  name,
  replacement
});

const PACKAGE_SCRIPT_REPLACEMENT_ENTRIES = Object.freeze([
  aliasEntry('api-server', 'pairofcleats service api'),
  aliasEntry('bench-language', 'pairofcleats bench language'),
  aliasEntry('bench-language:matrix', 'pairofcleats bench matrix'),
  aliasEntry('bench-language:summarize', 'pairofcleats bench summarize'),
  aliasEntry('bench-micro', 'pairofcleats bench micro'),
  aliasEntry('build-index', 'pairofcleats index build'),
  aliasEntry('build-lmdb-index', 'pairofcleats lmdb build'),
  aliasEntry('cache-gc', 'pairofcleats cache gc'),
  aliasEntry('compact-sqlite-index', 'pairofcleats sqlite compact'),
  aliasEntry('compare-models', 'pairofcleats report compare-models'),
  aliasEntry('config-dump', 'pairofcleats config dump'),
  aliasEntry('config-reset', 'pairofcleats config reset'),
  aliasEntry('config-validate', 'pairofcleats config validate'),
  aliasEntry('ctags-ingest', 'pairofcleats ingest ctags'),
  aliasEntry('eval-run', 'pairofcleats report eval'),
  aliasEntry('gtags-ingest', 'pairofcleats ingest gtags'),
  aliasEntry('index-validate', 'pairofcleats index validate'),
  aliasEntry('indexer-service', 'pairofcleats service indexer'),
  aliasEntry('lsif-ingest', 'pairofcleats ingest lsif'),
  aliasEntry('mcp-server', 'pairofcleats service mcp'),
  aliasEntry('metrics-dashboard', 'pairofcleats report metrics'),
  aliasEntry('parity:matrix', 'pairofcleats report parity'),
  aliasEntry('scip-ingest', 'pairofcleats ingest scip'),
  aliasEntry('search', 'pairofcleats search'),
  aliasEntry('show-throughput', 'pairofcleats report throughput'),
  aliasEntry('summary-report', 'pairofcleats report summary'),
  aliasEntry('tooling-detect', 'pairofcleats tooling detect'),
  aliasEntry('tooling-install', 'pairofcleats tooling install'),
  aliasEntry('tui:build', 'pairofcleats tui build --smoke'),
  aliasEntry('tui:install', 'pairofcleats tui install --json'),
  aliasEntry('tui:supervisor', 'pairofcleats tui supervisor'),
  aliasEntry('uninstall', 'pairofcleats tooling uninstall'),
  aliasEntry('watch-index', 'pairofcleats index watch')
]);

export const PACKAGE_SCRIPT_REPLACEMENTS = Object.freeze(
  Object.fromEntries(PACKAGE_SCRIPT_REPLACEMENT_ENTRIES.map((entry) => [entry.name, entry.replacement]))
);

export const listPackageScriptReplacements = () => PACKAGE_SCRIPT_REPLACEMENT_ENTRIES
  .slice()
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((entry) => ({ ...entry }));

export const getPackageScriptReplacement = (name) => {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  return PACKAGE_SCRIPT_REPLACEMENTS[normalized] || null;
};

export const describePackageScriptReplacementCommand = (replacement) => {
  const text = String(replacement || '').trim();
  if (!text.startsWith('pairofcleats ')) return null;
  const tokens = text.slice('pairofcleats '.length).trim().split(/\s+/).filter(Boolean);
  for (let length = tokens.length; length > 0; length -= 1) {
    const candidate = describeCommandRegistryEntry(tokens.slice(0, length).join(' '));
    if (candidate) {
      return {
        entry: candidate,
        extraArgs: tokens.slice(length)
      };
    }
  }
  return null;
};
