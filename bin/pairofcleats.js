#!/usr/bin/env node
import { execaSync } from 'execa';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeConfig, loadUserConfig, resolveNodeOptions, resolveRepoRoot } from '../tools/dict-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMMANDS = new Map([
  ['build-index', { script: 'build_index.js', extraArgs: [] }],
  ['index', { script: 'build_index.js', extraArgs: [] }],
  ['watch-index', { script: 'build_index.js', extraArgs: ['--watch'] }],
  ['search', { script: 'search.js', extraArgs: [] }],
  ['bootstrap', { script: 'tools/bootstrap.js', extraArgs: [] }],
  ['setup', { script: 'tools/setup.js', extraArgs: [] }],
  ['build-sqlite-index', { script: 'tools/build-sqlite-index.js', extraArgs: [] }],
  ['compact-sqlite-index', { script: 'tools/compact-sqlite-index.js', extraArgs: [] }],
  ['search-sqlite', { script: 'tools/search-sqlite.js', extraArgs: [] }],
  ['cache-gc', { script: 'tools/cache-gc.js', extraArgs: [] }],
  ['clean-artifacts', { script: 'tools/clean-artifacts.js', extraArgs: [] }],
  ['report-artifacts', { script: 'tools/report-artifacts.js', extraArgs: [] }],
  ['status', { script: 'tools/report-artifacts.js', extraArgs: [] }],
  ['index-validate', { script: 'tools/index-validate.js', extraArgs: [] }],
  ['download-dicts', { script: 'tools/download-dicts.js', extraArgs: [] }],
  ['download-models', { script: 'tools/download-models.js', extraArgs: [] }],
  ['download-extensions', { script: 'tools/download-extensions.js', extraArgs: [] }],
  ['verify-extensions', { script: 'tools/verify-extensions.js', extraArgs: [] }],
  ['generate-repo-dict', { script: 'tools/generate-repo-dict.js', extraArgs: [] }],
  ['tooling-detect', { script: 'tools/tooling-detect.js', extraArgs: [] }],
  ['tooling-install', { script: 'tools/tooling-install.js', extraArgs: [] }],
  ['git-hooks', { script: 'tools/git-hooks.js', extraArgs: [] }],
  ['ctags-ingest', { script: 'tools/ctags-ingest.js', extraArgs: [] }],
  ['scip-ingest', { script: 'tools/scip-ingest.js', extraArgs: [] }],
  ['lsif-ingest', { script: 'tools/lsif-ingest.js', extraArgs: [] }],
  ['gtags-ingest', { script: 'tools/gtags-ingest.js', extraArgs: [] }],
  ['structural-search', { script: 'tools/structural-search.js', extraArgs: [] }],
  ['bench-language', { script: 'tools/bench-language-repos.js', extraArgs: [] }],
  ['bench-language-matrix', { script: 'tools/bench-language-matrix.js', extraArgs: [] }],
  ['repometrics-dashboard', { script: 'tools/repometrics-dashboard.js', extraArgs: [] }],
  ['compare-models', { script: 'tools/compare-models.js', extraArgs: [] }],
  ['summary-report', { script: 'tools/combined-summary.js', extraArgs: [] }],
  ['eval-run', { script: 'tools/eval/run.js', extraArgs: [] }],
  ['api-server', { script: 'tools/api-server.js', extraArgs: [] }],
  ['server', { script: 'tools/api-server.js', extraArgs: [] }],
  ['indexer-service', { script: 'tools/indexer-service.js', extraArgs: [] }],
  ['uninstall', { script: 'tools/uninstall.js', extraArgs: [] }],
  ['mcp-server', { script: 'tools/mcp-server.js', extraArgs: [] }],
  ['mcp', { script: 'tools/mcp-server.js', extraArgs: [] }],
  ['config-validate', { script: 'tools/validate-config.js', extraArgs: [] }],
  ['triage-ingest', { script: 'tools/triage/ingest.js', extraArgs: [] }],
  ['triage-decision', { script: 'tools/triage/decision.js', extraArgs: [] }],
  ['triage-context-pack', { script: 'tools/triage/context-pack.js', extraArgs: [] }]
]);

const args = process.argv.slice(2);
const command = args[0];

if (!command || isHelpCommand(command)) {
  printHelp();
  process.exit(0);
}

if (isVersionCommand(command)) {
  console.log(readVersion());
  process.exit(0);
}

const primary = args.shift();
const resolved = resolveCommand(primary, args);
if (!resolved) {
  console.error(`Unknown command: ${primary}`);
  printHelp();
  process.exit(1);
}

runScript(resolved.script, resolved.extraArgs, resolved.args);

function resolveCommand(primary, rest) {
  if (primary === 'config') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      printConfigHelp();
      process.exit(sub ? 0 : 1);
    }
    if (sub === 'validate') {
      return { script: 'tools/validate-config.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown config subcommand: ${sub}`);
    printConfigHelp();
    process.exit(1);
  }
  if (primary === 'triage') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      printTriageHelp();
      process.exit(sub ? 0 : 1);
    }
    if (sub === 'ingest') {
      return { script: 'tools/triage/ingest.js', extraArgs: [], args: rest };
    }
    if (sub === 'decision') {
      return { script: 'tools/triage/decision.js', extraArgs: [], args: rest };
    }
    if (sub === 'context-pack') {
      return { script: 'tools/triage/context-pack.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown triage subcommand: ${sub}`);
    printTriageHelp();
    process.exit(1);
  }
  if (COMMANDS.has(primary)) {
    const entry = COMMANDS.get(primary);
    return { script: entry.script, extraArgs: entry.extraArgs || [], args: rest };
  }
  return null;
}

function runScript(scriptPath, extraArgs, restArgs) {
  const resolved = path.join(ROOT, scriptPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Script not found: ${resolved}`);
    process.exit(1);
  }
  const repoOverride = extractRepoArg(restArgs);
  const repoRoot = repoOverride ? path.resolve(repoOverride) : resolveRepoRoot(process.cwd());
  const userConfig = loadUserConfig(repoRoot);
  const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
  const nodeOptions = resolveNodeOptions(runtimeConfig, process.env.NODE_OPTIONS || '');
  const env = nodeOptions ? { ...process.env, NODE_OPTIONS: nodeOptions } : process.env;
  const result = execaSync(process.execPath, [resolved, ...extraArgs, ...restArgs], {
    stdio: 'inherit',
    env,
    reject: false
  });
  process.exit(result.exitCode ?? 1);
}

function extractRepoArg(args) {
  const idx = args.indexOf('--repo');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return null;
}

function isHelpCommand(value) {
  return value === 'help' || value === '--help' || value === '-h';
}

function isVersionCommand(value) {
  return value === 'version' || value === '--version' || value === '-v';
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp() {
  console.log(`Usage: pairofcleats <command> [args]

Core:
  build-index             Build file-backed indexes
  index                   Alias for build-index
  watch-index             Watch and rebuild indexes incrementally
  search                  Query indexed data
  status                  Report current artifacts/status
  index-validate           Validate index artifacts
  bootstrap               Fast bootstrap flow
  setup                   Guided setup flow
  build-sqlite-index       Build SQLite indexes
  compact-sqlite-index     Compact SQLite indexes
  search-sqlite            SQLite-specific search helper
  cache-gc                Garbage collect cache by age/size
  clean-artifacts          Remove repo artifacts (keep shared caches)
  report-artifacts         Report artifact sizes

Assets + tooling:
  download-dicts           Download dictionary files
  download-models          Download embedding models
  download-extensions      Download SQLite ANN extensions
  verify-extensions        Verify ANN extension availability
  generate-repo-dict        Build repo-specific dictionary
  tooling-detect           Detect optional language tooling
  tooling-install          Install optional language tooling
  git-hooks                Install git hooks
  ctags-ingest             Ingest ctags symbol dumps
  scip-ingest              Ingest SCIP symbol dumps
  lsif-ingest              Ingest LSIF dumps
  gtags-ingest             Ingest GNU Global dumps
  structural-search        Run structural rule packs
  bench-language           Run language benchmark suite
  bench-language-matrix    Run language/config benchmark matrix

Reports + services:
  repometrics-dashboard    Summarize repometrics
  compare-models           Compare search models
  summary-report           Generate summary report
  eval-run                 Run retrieval evaluation harness
  server                   Run local HTTP JSON API
  api-server               Alias for server
  indexer-service          Run multi-repo indexer service
  mcp-server               Run MCP server
  mcp                      Alias for mcp-server

Config + triage:
  config validate          Validate .pairofcleats.json
  triage ingest            Ingest triage records
  triage decision          Create triage decisions
  triage context-pack      Generate context packs

Aliases:
  config-validate          Same as config validate
  triage-ingest            Same as triage ingest
  triage-decision          Same as triage decision
  triage-context-pack      Same as triage context-pack`);
}

function printConfigHelp() {
  console.log(`Usage: pairofcleats config <subcommand> [args]

Subcommands:
  validate                 Validate .pairofcleats.json (see docs/config-schema.json)`);
}

function printTriageHelp() {
  console.log(`Usage: pairofcleats triage <subcommand> [args]

Subcommands:
  ingest                   Ingest triage findings
  decision                 Create triage decisions
  context-pack             Generate a context pack`);
}
