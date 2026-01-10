#!/usr/bin/env node
import { execaSync } from 'execa';
import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeConfig, loadUserConfig, resolveNodeOptions, resolveRepoRoot, resolveToolRoot } from '../tools/dict-utils.js';

const ROOT = resolveToolRoot();

const COMMANDS = new Map([
  ['search', { script: 'search.js', extraArgs: [] }],
  ['bootstrap', { script: 'tools/bootstrap.js', extraArgs: [] }],
  ['setup', { script: 'tools/setup.js', extraArgs: [] }],
  ['generate-repo-dict', { script: 'tools/generate-repo-dict.js', extraArgs: [] }],
  ['git-hooks', { script: 'tools/git-hooks.js', extraArgs: [] }],
  ['uninstall', { script: 'tools/uninstall.js', extraArgs: [] }]
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
  if (primary === 'index') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      return { script: 'build_index.js', extraArgs: [], args: rest };
    }
    if (sub === 'build') {
      return { script: 'build_index.js', extraArgs: [], args: rest };
    }
    if (sub === 'watch') {
      return { script: 'build_index.js', extraArgs: ['--watch'], args: rest };
    }
    if (sub === 'validate') {
      return { script: 'tools/index-validate.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown index subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'sqlite') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('sqlite requires a subcommand: build|compact|search');
      printHelp();
      process.exit(1);
    }
    if (sub === 'build') {
      return { script: 'tools/build-sqlite-index.js', extraArgs: [], args: rest };
    }
    if (sub === 'compact') {
      return { script: 'tools/compact-sqlite-index.js', extraArgs: [], args: rest };
    }
    if (sub === 'search') {
      return resolveSqliteSearch(rest);
    }
    console.error(`Unknown sqlite subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'bench') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('bench requires a subcommand: micro|language|matrix');
      printHelp();
      process.exit(1);
    }
    if (sub === 'micro') {
      return { script: 'tools/bench/micro/run.js', extraArgs: [], args: rest };
    }
    if (sub === 'language') {
      return { script: 'tools/bench-language-repos.js', extraArgs: [], args: rest };
    }
    if (sub === 'matrix') {
      return { script: 'tools/bench-language-matrix.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown bench subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'assets') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('assets requires a subcommand: dicts|models|extensions|extensions-verify');
      printHelp();
      process.exit(1);
    }
    if (sub === 'dicts') {
      return { script: 'tools/download-dicts.js', extraArgs: [], args: rest };
    }
    if (sub === 'models') {
      return { script: 'tools/download-models.js', extraArgs: [], args: rest };
    }
    if (sub === 'extensions') {
      return { script: 'tools/download-extensions.js', extraArgs: [], args: rest };
    }
    if (sub === 'extensions-verify') {
      return { script: 'tools/verify-extensions.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown assets subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'tooling') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('tooling requires a subcommand: detect|install');
      printHelp();
      process.exit(1);
    }
    if (sub === 'detect') {
      return { script: 'tools/tooling-detect.js', extraArgs: [], args: rest };
    }
    if (sub === 'install') {
      return { script: 'tools/tooling-install.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown tooling subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'ingest') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('ingest requires a subcommand: ctags|scip|lsif|gtags');
      printHelp();
      process.exit(1);
    }
    if (sub === 'ctags') {
      return { script: 'tools/ctags-ingest.js', extraArgs: [], args: rest };
    }
    if (sub === 'scip') {
      return { script: 'tools/scip-ingest.js', extraArgs: [], args: rest };
    }
    if (sub === 'lsif') {
      return { script: 'tools/lsif-ingest.js', extraArgs: [], args: rest };
    }
    if (sub === 'gtags') {
      return { script: 'tools/gtags-ingest.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown ingest subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'structural') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('structural requires a subcommand: search');
      printHelp();
      process.exit(1);
    }
    if (sub === 'search') {
      return { script: 'tools/structural-search.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown structural subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'service') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('service requires a subcommand: api|indexer|mcp');
      printHelp();
      process.exit(1);
    }
    if (sub === 'api') {
      return { script: 'tools/api-server.js', extraArgs: [], args: rest };
    }
    if (sub === 'indexer') {
      return { script: 'tools/indexer-service.js', extraArgs: [], args: rest };
    }
    if (sub === 'mcp') {
      return { script: 'tools/mcp-server.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown service subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'report') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('report requires a subcommand: repometrics|compare-models|summary|eval');
      printHelp();
      process.exit(1);
    }
    if (sub === 'repometrics') {
      return { script: 'tools/repometrics-dashboard.js', extraArgs: [], args: rest };
    }
    if (sub === 'compare-models') {
      return { script: 'tools/compare-models.js', extraArgs: [], args: rest };
    }
    if (sub === 'summary') {
      return { script: 'tools/combined-summary.js', extraArgs: [], args: rest };
    }
    if (sub === 'eval') {
      return { script: 'tools/eval/run.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown report subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'cache') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('cache requires a subcommand: gc|clean|report');
      printHelp();
      process.exit(1);
    }
    if (sub === 'gc') {
      return { script: 'tools/cache-gc.js', extraArgs: [], args: rest };
    }
    if (sub === 'clean') {
      return { script: 'tools/clean-artifacts.js', extraArgs: [], args: rest };
    }
    if (sub === 'report') {
      return { script: 'tools/report-artifacts.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown cache subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'embeddings') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      console.error('embeddings requires a subcommand: build');
      printHelp();
      process.exit(1);
    }
    if (sub === 'build') {
      return { script: 'tools/build-embeddings.js', extraArgs: [], args: rest };
    }
    console.error(`Unknown embeddings subcommand: ${sub}`);
    printHelp();
    process.exit(1);
  }
  if (primary === 'config') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      printConfigHelp();
      process.exit(sub ? 0 : 1);
    }
    if (sub === 'validate') {
      return { script: 'tools/validate-config.js', extraArgs: [], args: rest };
    }
    if (sub === 'dump') {
      return { script: 'tools/config-dump.js', extraArgs: [], args: rest };
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

function resolveSqliteSearch(args) {
  const hasBackend = args.some((arg) => arg === '--backend' || arg.startsWith('--backend='));
  const extraArgs = hasBackend ? [] : ['--backend', 'sqlite-fts'];
  return { script: 'search.js', extraArgs, args };
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
  index build             Build file-backed indexes
  index watch             Watch and rebuild indexes incrementally
  index validate          Validate index artifacts
  search                  Query indexed data
  embeddings build        Build embedding vectors from chunk metadata
  bootstrap               Fast bootstrap flow
  setup                   Guided setup flow

SQLite:
  sqlite build            Build SQLite indexes
  sqlite compact          Compact SQLite indexes
  sqlite search           SQLite-specific search helper

Bench:
  bench micro             Run microbench suite
  bench language          Run language benchmark suite
  bench matrix            Run language/config benchmark matrix

Assets:
  assets dicts            Download dictionary files
  assets models           Download embedding models
  assets extensions       Download SQLite ANN extensions
  assets extensions-verify Verify ANN extension availability

Tooling:
  tooling detect          Detect optional language tooling
  tooling install         Install optional language tooling

Ingest:
  ingest ctags            Ingest ctags symbol dumps
  ingest scip             Ingest SCIP symbol dumps
  ingest lsif             Ingest LSIF dumps
  ingest gtags            Ingest GNU Global dumps

Structural:
  structural search       Run structural rule packs

Cache:
  cache gc                Garbage collect cache by age/size
  cache clean             Remove repo artifacts (keep shared caches)
  cache report            Report artifact sizes

Reports:
  report repometrics      Summarize repometrics
  report compare-models   Compare search models
  report summary          Generate summary report
  report eval             Run retrieval evaluation harness

Services:
  service api             Run local HTTP JSON API
  service indexer         Run multi-repo indexer service
  service mcp             Run MCP server

Other:
  generate-repo-dict       Build repo-specific dictionary
  git-hooks                Install git hooks

Config + triage:
  config validate          Validate .pairofcleats.json
  config dump              Show effective config + derived paths
  triage ingest            Ingest triage records
  triage decision          Create triage decisions
  triage context-pack      Generate context packs
`);
}

function printConfigHelp() {
  console.log(`Usage: pairofcleats config <subcommand> [args]

Subcommands:
  validate                 Validate .pairofcleats.json (see docs/config-schema.json)
  dump                     Show effective config + derived paths`);
}

function printTriageHelp() {
  console.log(`Usage: pairofcleats triage <subcommand> [args]

Subcommands:
  ingest                   Ingest triage findings
  decision                 Create triage decisions
  context-pack             Generate a context pack`);
}
