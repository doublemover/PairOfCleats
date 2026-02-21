#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveRepoRoot,
  resolveToolRoot
} from '../tools/shared/dict-utils.js';
import { INDEX_BUILD_OPTIONS } from '../src/shared/cli-options.js';
import { spawnSubprocessSync } from '../src/shared/subprocess.js';
import { buildErrorPayload, ERROR_CODES, isErrorCode } from '../src/shared/error-codes.js';
import { resolveDispatchRuntimeEnv } from '../src/shared/dispatch/env.js';

const ROOT = resolveToolRoot();

const args = process.argv.slice(2);
const command = args[0];

if (!command || isHelpCommand(command)) {
  printHelp();
  process.exit(0);
}

if (isVersionCommand(command)) {
  console.error(readVersion());
  process.exit(0);
}

const primary = args.shift();
const resolved = resolveCommand(primary, args);
if (!resolved) {
  failCli(`Unknown command: ${primary}`, {
    code: ERROR_CODES.INVALID_REQUEST,
    showHelp: true
  });
}

runScript(resolved.script, resolved.extraArgs, resolved.args).catch((err) => {
  const code = isErrorCode(err?.code) ? err.code : ERROR_CODES.INTERNAL;
  failCli(err?.message || String(err), {
    code,
    hint: err?.hint || null
  });
});

function resolveCommand(primary, rest) {
  if (primary === 'index') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      return { script: 'build_index.js', extraArgs: [], args: rest };
    }
    if (sub === 'build') {
      if (readFlagValue(rest, 'workspace')) {
        const buildFlags = Object.keys(INDEX_BUILD_OPTIONS).filter((flag) => flag !== 'repo');
        const allowed = Array.from(new Set([
          'workspace',
          'concurrency',
          'strict',
          'include-disabled',
          'json',
          ...buildFlags
        ]));
        const buildValueFlags = buildFlags.filter((flag) => (
          INDEX_BUILD_OPTIONS[flag]?.type && INDEX_BUILD_OPTIONS[flag].type !== 'boolean'
        ));
        validateArgs(rest, allowed, ['workspace', 'concurrency', ...buildValueFlags]);
        return { script: 'tools/workspace/build.js', extraArgs: [], args: rest };
      }
      return { script: 'build_index.js', extraArgs: [], args: rest };
    }
    if (sub === 'watch') {
      return { script: 'build_index.js', extraArgs: ['--watch'], args: rest };
    }
    if (sub === 'validate') {
      return { script: 'tools/index/validate.js', extraArgs: [], args: rest };
    }
    if (sub === 'stats') {
      validateArgs(rest, ['repo', 'index-dir', 'mode', 'json', 'verify'], ['repo', 'index-dir', 'mode']);
      return { script: 'tools/index/stats.js', extraArgs: [], args: rest };
    }
    if (sub === 'snapshot') {
      validateArgs(
        rest,
        [
          'repo',
          'snapshot',
          'modes',
          'id',
          'label',
          'notes',
          'tags',
          'tag',
          'method',
          'verify',
          'include-sqlite',
          'include-lmdb',
          'wait-ms',
          'keep-frozen',
          'keep-pointer',
          'keep-tags',
          'max-age-days',
          'staging-max-age-hours',
          'max-pointer-snapshots',
          'dry-run',
          'force',
          'json'
        ],
        [
          'repo',
          'snapshot',
          'modes',
          'id',
          'label',
          'notes',
          'tags',
          'tag',
          'method',
          'include-sqlite',
          'wait-ms',
          'keep-frozen',
          'keep-pointer',
          'keep-tags',
          'max-age-days',
          'staging-max-age-hours',
          'max-pointer-snapshots'
        ]
      );
      return { script: 'tools/index-snapshot.js', extraArgs: [], args: rest };
    }
    if (sub === 'diff') {
      validateArgs(
        rest,
        [
          'repo',
          'from',
          'to',
          'modes',
          'mode',
          'max-changed-files',
          'max-chunks-per-file',
          'max-events',
          'max-bytes',
          'include-relations',
          'detect-renames',
          'allow-mismatch',
          'persist',
          'persist-unsafe',
          'diff',
          'format',
          'max-diffs',
          'retain-days',
          'wait-ms',
          'dry-run',
          'json',
          'compact'
        ],
        [
          'repo',
          'from',
          'to',
          'modes',
          'mode',
          'max-changed-files',
          'max-chunks-per-file',
          'max-events',
          'max-bytes',
          'diff',
          'format',
          'max-diffs',
          'retain-days',
          'wait-ms'
        ]
      );
      return { script: 'tools/index-diff.js', extraArgs: [], args: rest };
    }
    return { script: 'build_index.js', extraArgs: [], args: [sub, ...rest] };
  }
  if (primary === 'search') {
    return { script: 'search.js', extraArgs: [], args: rest };
  }
  if (primary === 'dispatch') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub) || sub === 'list') {
      return { script: 'tools/dispatch/manifest.js', extraArgs: ['list'], args: rest };
    }
    if (sub === 'describe') {
      return { script: 'tools/dispatch/manifest.js', extraArgs: ['describe'], args: rest };
    }
    failCli(`Unknown dispatch subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'workspace') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('workspace requires a subcommand: manifest, status, build, catalog', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'manifest') {
      validateArgs(rest, ['workspace', 'json'], ['workspace']);
      return { script: 'tools/workspace/manifest.js', extraArgs: [], args: rest };
    }
    if (sub === 'status') {
      validateArgs(rest, ['workspace', 'json'], ['workspace']);
      return { script: 'tools/workspace/status.js', extraArgs: [], args: rest };
    }
    if (sub === 'build') {
      const buildFlags = Object.keys(INDEX_BUILD_OPTIONS).filter((flag) => flag !== 'repo');
      const allowed = Array.from(new Set([
        'workspace',
        'concurrency',
        'strict',
        'include-disabled',
        'json',
        ...buildFlags
      ]));
      const buildValueFlags = buildFlags.filter((flag) => (
        INDEX_BUILD_OPTIONS[flag]?.type && INDEX_BUILD_OPTIONS[flag].type !== 'boolean'
      ));
      validateArgs(rest, allowed, ['workspace', 'concurrency', ...buildValueFlags]);
      return { script: 'tools/workspace/build.js', extraArgs: [], args: rest };
    }
    if (sub === 'catalog') {
      validateArgs(rest, ['workspace', 'json'], ['workspace']);
      return { script: 'tools/workspace/catalog.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown workspace subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'setup') {
    validateArgs(rest, [], []);
    return { script: 'tools/setup/setup.js', extraArgs: [], args: rest };
  }
  if (primary === 'bootstrap') {
    validateArgs(rest, [], []);
    return { script: 'tools/setup/bootstrap.js', extraArgs: [], args: rest };
  }
  if (primary === 'cache') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('cache requires a subcommand: clear, gc', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'clear') {
      validateArgs(rest, ['all', 'force', 'cache-root'], ['cache-root']);
      return { script: 'tools/cache/clear-cache.js', extraArgs: [], args: rest };
    }
    if (sub === 'gc') {
      validateArgs(
        rest,
        [
          'apply',
          'dry-run',
          'json',
          'cache-root',
          'grace-days',
          'max-deletes',
          'concurrency',
          'max-bytes',
          'max-gb',
          'max-age-days',
          'repo'
        ],
        [
          'cache-root',
          'grace-days',
          'max-deletes',
          'concurrency',
          'max-bytes',
          'max-gb',
          'max-age-days',
          'repo'
        ]
      );
      return { script: 'tools/index/cache-gc.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown cache subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'report') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('report requires a subcommand: map, eval, compare-models, metrics', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'map') {
      validateArgs(
        rest,
        [
          'repo',
          'mode',
          'index-root',
          'scope',
          'focus',
          'include',
          'only-exported',
          'collapse',
          'max-files',
          'max-members-per-file',
          'max-edges',
          'top-k-by-degree',
          'format',
          'out',
          'model-out',
          'node-list-out',
          'json',
          'pretty',
          'open-uri-template',
          'three-url',
          'wasd-sensitivity',
          'wasd-acceleration',
          'wasd-max-speed',
          'wasd-drag',
          'zoom-sensitivity',
          'cache-dir',
          'refresh'
        ],
        [
          'repo',
          'mode',
          'index-root',
          'scope',
          'focus',
          'include',
          'collapse',
          'max-files',
          'max-members-per-file',
          'max-edges',
          'format',
          'out',
          'model-out',
          'node-list-out',
          'open-uri-template',
          'three-url',
          'wasd-sensitivity',
          'wasd-acceleration',
          'wasd-max-speed',
          'wasd-drag',
          'zoom-sensitivity',
          'cache-dir'
        ]
      );
      return { script: 'tools/reports/report-code-map.js', extraArgs: [], args: rest };
    }
    if (sub === 'eval') {
      validateArgs(
        rest,
        [
          'repo',
          'dataset',
          'backend',
          'top',
          'ann',
          'out',
          'pretty',
          'match-mode',
          'progress',
          'verbose',
          'quiet'
        ],
        [
          'repo',
          'dataset',
          'backend',
          'top',
          'out',
          'match-mode',
          'progress'
        ]
      );
      return { script: 'tools/eval/run.js', extraArgs: [], args: rest };
    }
    if (sub === 'compare-models') {
      validateArgs(
        rest,
        [
          'json',
          'build',
          'build-index',
          'build-sqlite',
          'incremental',
          'stub-embeddings',
          'ann',
          'no-ann',
          'models',
          'baseline',
          'queries',
          'backend',
          'out',
          'mode',
          'cache-root',
          'repo',
          'top',
          'limit'
        ],
        [
          'models',
          'baseline',
          'queries',
          'backend',
          'out',
          'mode',
          'cache-root',
          'repo',
          'top',
          'limit'
        ]
      );
      return { script: 'tools/reports/compare-models.js', extraArgs: [], args: rest };
    }
    if (sub === 'metrics') {
      validateArgs(rest, ['json', 'out', 'repo', 'top'], ['out', 'repo', 'top']);
      return { script: 'tools/reports/metrics-dashboard.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown report subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'service') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('service requires a subcommand: api, indexer', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'api') {
      validateArgs(rest, ['host', 'port', 'repo'], ['host', 'port', 'repo']);
      return { script: 'tools/api/server.js', extraArgs: [], args: rest };
    }
    if (sub === 'indexer') {
      validateArgs(
        rest,
        ['config', 'repo', 'mode', 'reason', 'stage', 'command', 'watch', 'interval', 'concurrency', 'queue'],
        ['config', 'repo', 'mode', 'reason', 'stage', 'command', 'interval', 'concurrency', 'queue']
      );
      return { script: 'tools/service/indexer-service.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown service subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'ingest') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('ingest requires a subcommand: ctags, gtags, lsif, scip', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'ctags') {
      return { script: 'tools/ingest/ctags.js', extraArgs: [], args: rest };
    }
    if (sub === 'gtags') {
      return { script: 'tools/ingest/gtags.js', extraArgs: [], args: rest };
    }
    if (sub === 'lsif') {
      return { script: 'tools/ingest/lsif.js', extraArgs: [], args: rest };
    }
    if (sub === 'scip') {
      return { script: 'tools/ingest/scip.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown ingest subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'tui') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('tui requires a subcommand: supervisor, build, install', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'supervisor') {
      return { script: 'tools/tui/supervisor.js', extraArgs: [], args: rest };
    }
    if (sub === 'build') {
      return { script: 'tools/tui/build.js', extraArgs: [], args: rest };
    }
    if (sub === 'install') {
      return { script: 'tools/tui/install.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown tui subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'graph-context') {
    validateArgs(
      rest,
      [
        'repo',
        'seed',
        'depth',
        'direction',
        'format',
        'json',
        'includePaths',
        'graphs',
        'edgeTypes',
        'minConfidence',
        'maxDepth',
        'maxFanoutPerNode',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ],
      [
        'repo',
        'seed',
        'depth',
        'direction',
        'format',
        'graphs',
        'edgeTypes',
        'minConfidence',
        'maxDepth',
        'maxFanoutPerNode',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ]
    );
    return { script: 'tools/analysis/graph-context.js', extraArgs: [], args: rest };
  }
  if (primary === 'architecture-check') {
    validateArgs(
      rest,
      [
        'repo',
        'rules',
        'format',
        'json',
        'fail-on-violation',
        'failOnViolation',
        'maxViolations',
        'maxEdgesExamined'
      ],
      ['repo', 'rules', 'format', 'maxViolations', 'maxEdgesExamined']
    );
    return { script: 'tools/analysis/architecture-check.js', extraArgs: [], args: rest };
  }
  if (primary === 'suggest-tests') {
    validateArgs(
      rest,
      [
        'repo',
        'changed',
        'changedFile',
        'changed-file',
        'max',
        'format',
        'json',
        'testPattern',
        'test-pattern',
        'maxDepth',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ],
      [
        'repo',
        'changed',
        'changedFile',
        'changed-file',
        'max',
        'format',
        'testPattern',
        'test-pattern',
        'maxDepth',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ]
    );
    return { script: 'tools/analysis/suggest-tests.js', extraArgs: [], args: rest };
  }
  if (primary === 'context-pack') {
    validateArgs(
      rest,
      [
        'repo',
        'seed',
        'hops',
        'maxTokens',
        'maxBytes',
        'includeGraph',
        'includeTypes',
        'includeRisk',
        'includeImports',
        'includeUsages',
        'includeCallersCallees',
        'includePaths',
        'maxTypeEntries',
        'format',
        'json',
        'maxDepth',
        'maxFanoutPerNode',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ],
      [
        'repo',
        'seed',
        'hops',
        'maxTokens',
        'maxBytes',
        'maxTypeEntries',
        'format',
        'maxDepth',
        'maxFanoutPerNode',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ]
    );
    return { script: 'tools/analysis/context-pack.js', extraArgs: [], args: rest };
  }
  if (primary === 'api-contracts') {
    validateArgs(
      rest,
      [
        'repo',
        'onlyExports',
        'failOnWarn',
        'format',
        'json',
        'maxSymbols',
        'maxCallsPerSymbol',
        'maxCalls',
        'maxWarnings',
        'emitArtifact',
        'artifactDir'
      ],
      ['repo', 'format', 'maxSymbols', 'maxCallsPerSymbol', 'maxCalls', 'maxWarnings', 'artifactDir']
    );
    return { script: 'tools/api/contracts.js', extraArgs: [], args: rest };
  }
  if (primary === 'impact') {
    validateArgs(
      rest,
      [
        'repo',
        'seed',
        'changed',
        'changedFile',
        'depth',
        'direction',
        'format',
        'json',
        'graphs',
        'edgeTypes',
        'minConfidence',
        'maxDepth',
        'maxFanoutPerNode',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ],
      [
        'repo',
        'seed',
        'changed',
        'changedFile',
        'depth',
        'direction',
        'format',
        'graphs',
        'edgeTypes',
        'minConfidence',
        'maxDepth',
        'maxFanoutPerNode',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ]
    );
    return { script: 'tools/analysis/impact.js', extraArgs: [], args: rest };
  }
  if (primary === 'tooling') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('tooling requires a subcommand: doctor', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'doctor') {
      validateArgs(rest, ['repo', 'json', 'strict', 'non-strict'], ['repo']);
      return { script: 'tools/tooling/doctor.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown tooling subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'lmdb') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('lmdb requires a subcommand: build', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'build') {
      validateArgs(rest, ['repo', 'mode', 'index-root', 'as-of', 'snapshot', 'validate'], ['repo', 'mode', 'index-root', 'as-of', 'snapshot']);
      return { script: 'tools/build/lmdb-index.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown lmdb subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'risk') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('risk requires a subcommand: explain', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'explain') {
      validateArgs(
        rest,
        ['index', 'chunk', 'max', 'source-rule', 'sink-rule', 'json'],
        ['index', 'chunk', 'max', 'source-rule', 'sink-rule']
      );
      return { script: 'tools/analysis/explain-risk.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown risk subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  return null;
}

function validateArgs(args, allowedFlags, valueFlags) {
  const allowed = new Set(allowedFlags);
  const expectsValue = new Set(valueFlags);
  const errors = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === '--') break;
    if (!arg.startsWith('-')) continue;
    if (arg === '--help' || arg === '-h') continue;
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      const flag = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex);
      if (!allowed.has(flag)) {
        errors.push(`Unknown flag: --${flag}`);
        continue;
      }
      if (expectsValue.has(flag)) {
        if (eqIndex !== -1) continue;
        const next = args[i + 1];
        if (!next || String(next).startsWith('-')) {
          errors.push(`Missing value for --${flag}`);
        } else {
          i += 1;
        }
      }
      continue;
    }
    if (arg.startsWith('-')) {
      errors.push(`Unknown short flag: ${arg}`);
    }
  }
  if (errors.length) {
    failCli(errors.join('\n'), {
      code: ERROR_CODES.INVALID_REQUEST
    });
  }
}

function readFlagValue(args, name) {
  const flag = `--${name}`;
  const flagEq = `${flag}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if (arg === flag) {
      const next = args[i + 1];
      return next ? String(next) : null;
    }
    if (arg.startsWith(flagEq)) {
      return arg.slice(flagEq.length);
    }
  }
  return null;
}

async function runScript(scriptPath, extraArgs, restArgs) {
  const resolved = path.join(ROOT, scriptPath);
  if (!fs.existsSync(resolved)) {
    failCli(`Script not found: ${resolved}`, {
      code: ERROR_CODES.NOT_FOUND
    });
  }
  const repoOverride = extractRepoArg(restArgs);
  const repoRoot = repoOverride ? path.resolve(repoOverride) : resolveRepoRoot(process.cwd());
  const env = await resolveDispatchRuntimeEnv({
    root: repoRoot,
    scriptPath,
    extraArgs,
    restArgs,
    baseEnv: process.env
  });
  const result = spawnSubprocessSync(process.execPath, [resolved, ...extraArgs, ...restArgs], {
    stdio: 'inherit',
    env,
    rejectOnNonZeroExit: false
  });
  process.exit(result.exitCode ?? 1);
}

function extractRepoArg(args) {
  const endOfOptions = args.indexOf('--');
  const scanArgs = endOfOptions === -1 ? args : args.slice(0, endOfOptions);
  for (let i = 0; i < scanArgs.length; i += 1) {
    const arg = scanArgs[i];
    if (arg === '--repo' && scanArgs[i + 1]) return scanArgs[i + 1];
    if (arg.startsWith('--repo=')) {
      const value = arg.slice('--repo='.length);
      if (value) return value;
    }
  }
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
  process.stderr.write(`Usage: pairofcleats <command> [args]

Core:
  setup                   Guided setup flow
  bootstrap               Fast bootstrap flow

Index:
  index build             Build file-backed indexes
  index watch             Watch and rebuild indexes incrementally
  index validate          Validate index artifacts
  index stats             Report per-mode manifest-driven index artifact stats
  index snapshot          Manage index snapshots (create/list/show/rm/freeze/gc)
  index diff              Compute/list/show/explain/prune index diffs

Search:
  search "<query>"         Query indexed data

Workspace:
  workspace manifest       Generate/refresh workspace manifest
  workspace status         Show workspace repo/mode index availability
  workspace build          Build indexes across workspace repos
  workspace catalog        Inspect workspace cache/manifests (debug)

Service:
  service api             Run local HTTP JSON API
  service indexer         Run indexer service queue/worker

Ingest:
  ingest ctags            Ingest ctags JSONL symbols into normalized records
  ingest gtags            Ingest GNU Global symbols into normalized records
  ingest lsif             Ingest LSIF dumps into normalized records
  ingest scip             Ingest SCIP indexes into normalized records

TUI:
  tui supervisor          Run Node supervisor for terminal-owned TUI sessions
  tui build               Generate deterministic TUI artifact manifest/checksums
  tui install             Install the selected TUI artifact locally

Dispatch:
  dispatch list           List shared dispatch manifest entries
  dispatch describe       Describe one shared dispatch command

Tooling:
  tooling doctor          Inspect tooling availability and config

Cache:
  cache clear             Remove cache data safely
  cache gc                Run cache GC planner (CAS + legacy quota mode)

LMDB:
  lmdb build              Build LMDB indexes

Report:
  report map              Generate code map artifacts
  report eval             Run evaluation suites
  report compare-models   Compare embedding models
  report metrics          Summarize metrics dashboard

Graph:
  graph-context          Build a graph context pack for a seed
  context-pack           Build a composite context pack for a seed
  api-contracts          Report cross-file API contracts
  architecture-check     Evaluate architecture rules over graphs
  suggest-tests          Suggest tests impacted by a change list
  impact                 Compute bounded graph impact for a seed or change set

Risk:
  risk explain            Explain interprocedural risk flows
`);
}

function failCli(message, { code = ERROR_CODES.INVALID_REQUEST, hint = null, showHelp = false, exitCode = 1 } = {}) {
  const payload = buildErrorPayload({
    code,
    message,
    details: hint ? { hint } : {}
  });
  process.stderr.write(`[${payload.code}] ${payload.message}\n`);
  if (payload.hint) {
    process.stderr.write(`hint: ${payload.hint}\n`);
  }
  if (showHelp) {
    printHelp();
  }
  process.exit(exitCode);
}
