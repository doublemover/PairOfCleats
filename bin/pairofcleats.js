#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  getToolVersion,
  resolveRepoRoot,
  resolveToolRoot
} from '../tools/shared/dict-utils.js';
import {
  INDEX_BUILD_OPTIONS,
  SERVICE_API_OPTIONS,
  SERVICE_INDEXER_OPTIONS,
  resolveCliOptionFlagSets
} from '../src/shared/cli-options.js';
import {
  COMMAND_SUPPORT_TIER_LABELS,
  DEFAULT_HELP_SUPPORT_TIERS,
  describeCommandRegistryEntry,
  listCommandRegistry,
  listCommonWorkflowExamples,
  listHelpSections
} from '../src/shared/command-registry.js';
import { spawnSubprocessSync } from '../src/shared/subprocess.js';
import { exitLikeChild } from '../src/tui/wrapper-exit.js';
import { buildErrorPayload, ERROR_CODES, isErrorCode } from '../src/shared/error-codes.js';
import { resolveDispatchRuntimeEnv } from '../src/shared/dispatch/env.js';

const ROOT = resolveToolRoot();

const args = process.argv.slice(2);
const command = args[0];

if (command === 'help') {
  printRequestedHelp(args.slice(1));
  process.exit(0);
}

if (!command || isHelpCommand(command) || isHelpAllCommand(command)) {
  printHelp({
    includeAll: isHelpAllCommand(command) || args.includes('--all')
  });
  process.exit(0);
}

if (isVersionCommand(command)) {
  console.error(getToolVersion() || '0.0.0');
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

/**
 * Resolve CLI command + subcommand matrix into a script dispatch target.
 *
 * @param {string} primary
 * @param {string[]} rest
 * @returns {{script:string,extraArgs:string[],args:string[]}|null}
 */
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
          'json'
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
  if (primary === 'config') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('config requires a subcommand: dump, validate, reset', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'dump') {
      validateArgs(rest, ['repo', 'json'], ['repo']);
      return { script: 'tools/config/dump.js', extraArgs: [], args: rest };
    }
    if (sub === 'validate') {
      validateArgs(rest, ['json', 'repo', 'config'], ['repo', 'config']);
      return { script: 'tools/config/validate.js', extraArgs: [], args: rest };
    }
    if (sub === 'reset') {
      validateArgs(rest, ['repo', 'config', 'force', 'backup', 'json'], ['repo', 'config']);
      return { script: 'tools/config/reset.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown config subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'cli') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('cli requires a subcommand: completions, audit', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'completions') {
      validateArgs(rest, ['shell'], ['shell']);
      return { script: 'tools/cli/completions.js', extraArgs: [], args: rest };
    }
    if (sub === 'audit') {
      validateArgs(rest, ['root', 'json'], ['root']);
      return { script: 'tools/ci/check-command-surface.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown cli subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
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
    return { script: 'tools/setup/setup.js', extraArgs: [], args: rest };
  }
  if (primary === 'bootstrap') {
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
      failCli('report requires a subcommand: map, eval, compare-models, throughput, summary, parity, metrics', {
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
    if (sub === 'throughput') {
      return { script: 'tools/reports/show-throughput.js', extraArgs: [], args: rest };
    }
    if (sub === 'summary') {
      return { script: 'tools/reports/combined-summary.js', extraArgs: [], args: rest };
    }
    if (sub === 'parity') {
      return { script: 'tools/reports/parity-matrix.js', extraArgs: [], args: rest };
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
      failCli('service requires a subcommand: api, mcp, indexer', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'api') {
      const { optionNames, valueOptionNames } = resolveCliOptionFlagSets(SERVICE_API_OPTIONS);
      validateArgs(
        rest,
        optionNames,
        valueOptionNames
      );
      return { script: 'tools/api/server.js', extraArgs: [], args: rest };
    }
    if (sub === 'mcp') {
      validateArgs(rest, ['repo', 'mcp-mode'], ['repo', 'mcp-mode']);
      return { script: 'tools/mcp/server.js', extraArgs: [], args: rest };
    }
    if (sub === 'indexer') {
      const { optionNames, valueOptionNames } = resolveCliOptionFlagSets(SERVICE_INDEXER_OPTIONS);
      validateArgs(
        rest,
        optionNames,
        valueOptionNames
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
  if (primary === 'bench') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('bench requires a subcommand: language, matrix, summarize, micro', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'language') {
      return { script: 'tools/bench/language-repos.js', extraArgs: [], args: rest };
    }
    if (sub === 'matrix') {
      return { script: 'tools/bench/language-matrix.js', extraArgs: [], args: rest };
    }
    if (sub === 'summarize') {
      return { script: 'tools/bench/language-summarize.js', extraArgs: [], args: rest };
    }
    if (sub === 'micro') {
      return { script: 'tools/bench/micro/run.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown bench subcommand: ${sub}`, {
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
        'includeRiskPartialFlows',
        'strictRisk',
        'rule',
        'category',
        'severity',
        'tag',
        'source',
        'sink',
        'flowId',
        'flow-id',
        'sourceRule',
        'source-rule',
        'sinkRule',
        'sink-rule',
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
        'rule',
        'category',
        'severity',
        'tag',
        'source',
        'sink',
        'flowId',
        'flow-id',
        'sourceRule',
        'source-rule',
        'sinkRule',
        'sink-rule',
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
      failCli('tooling requires a subcommand: doctor, detect, install, navigate, uninstall', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'doctor') {
      validateArgs(rest, ['repo', 'json', 'strict', 'non-strict'], ['repo']);
      return { script: 'tools/tooling/doctor.js', extraArgs: [], args: rest };
    }
    if (sub === 'detect') {
      validateArgs(rest, ['json', 'root', 'repo', 'languages'], ['root', 'repo', 'languages']);
      return { script: 'tools/tooling/detect.js', extraArgs: [], args: rest };
    }
    if (sub === 'install') {
      validateArgs(rest, ['json', 'dry-run', 'no-fallback', 'root', 'repo', 'scope', 'languages', 'tools'], ['root', 'repo', 'scope', 'languages', 'tools']);
      return { script: 'tools/tooling/install.js', extraArgs: [], args: rest };
    }
    if (sub === 'navigate') {
      validateArgs(rest, ['repo', 'kind', 'symbol', 'file', 'top', 'json'], ['repo', 'kind', 'symbol', 'file', 'top']);
      return { script: 'tools/tooling/navigation.js', extraArgs: [], args: rest };
    }
    if (sub === 'uninstall') {
      validateArgs(rest, ['yes', 'dry-run', 'repo'], ['repo']);
      return { script: 'tools/tooling/uninstall.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown tooling subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  if (primary === 'sqlite') {
    const sub = rest.shift();
    if (!sub || isHelpCommand(sub)) {
      failCli('sqlite requires a subcommand: compact', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'compact') {
      return { script: 'tools/build/compact-sqlite-index.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown sqlite subcommand: ${sub}`, {
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
      failCli('risk requires a subcommand: explain, delta', {
        code: ERROR_CODES.INVALID_REQUEST,
        showHelp: true
      });
    }
    if (sub === 'explain') {
      validateArgs(
        rest,
        ['index', 'chunk', 'max', 'rule', 'category', 'severity', 'tag', 'source', 'sink', 'flow-id', 'source-rule', 'sink-rule', 'json', 'format', 'includePartialFlows', 'maxPartialFlows', 'include-partial-flows', 'max-partial-flows'],
        ['index', 'chunk', 'max', 'rule', 'category', 'severity', 'tag', 'source', 'sink', 'flow-id', 'source-rule', 'sink-rule', 'format', 'maxPartialFlows', 'max-partial-flows']
      );
      return { script: 'tools/analysis/explain-risk.js', extraArgs: [], args: rest };
    }
    if (sub === 'delta') {
      validateArgs(
        rest,
        [
          'repo',
          'from',
          'to',
          'seed',
          'rule',
          'category',
          'severity',
          'tag',
          'source',
          'sink',
          'flow-id',
          'source-rule',
          'sink-rule',
          'json',
          'format',
          'includePartialFlows',
          'include-partial-flows'
        ],
        [
          'repo',
          'from',
          'to',
          'seed',
          'rule',
          'category',
          'severity',
          'tag',
          'source',
          'sink',
          'flow-id',
          'source-rule',
          'sink-rule',
          'format'
        ]
      );
      return { script: 'tools/analysis/delta-risk.js', extraArgs: [], args: rest };
    }
    failCli(`Unknown risk subcommand: ${sub}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }
  return null;
}

/**
 * Validate command args against allowed/value flag sets and fail on invalid use.
 *
 * @param {string[]} args
 * @param {string[]} allowedFlags
 * @param {string[]} valueFlags
 * @returns {void}
 */
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

/**
 * Read flag value from argv supporting `--name value` and `--name=value`.
 *
 * @param {string[]} args
 * @param {string} name
 * @returns {string|null}
 */
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

/**
 * Execute resolved script target with dispatch runtime env propagation.
 *
 * @param {string} scriptPath
 * @param {string[]} extraArgs
 * @param {string[]} restArgs
 * @returns {Promise<never>}
 */
async function runScript(scriptPath, extraArgs, restArgs) {
  const resolved = path.join(ROOT, scriptPath);
  if (!fs.existsSync(resolved)) {
    failCli(`Script not found: ${resolved}`, {
      code: ERROR_CODES.NOT_FOUND
    });
  }
  const repoOverride = extractRepoArg(restArgs);
  const repoRoot = repoOverride ? path.resolve(repoOverride) : resolveRepoRoot(process.cwd());
  const env = shouldSkipDispatchRuntimeEnvResolution(scriptPath)
    ? { ...process.env }
    : await resolveDispatchRuntimeEnv({
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
  exitLikeChild({
    status: result.exitCode,
    signal: result.signal
  });
}

/**
 * Extract `--repo` override from CLI args before end-of-options marker.
 *
 * Supports `--repo value` and `--repo=value` forms.
 *
 * @param {string[]} args
 * @returns {string|null}
 */
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

/**
 * Commands that either recover from invalid config or do not benefit from
 * wrapper-side runtime envelope shaping should launch with the caller env.
 *
 * @param {string} scriptPath
 * @returns {boolean}
 */
function shouldSkipDispatchRuntimeEnvResolution(scriptPath) {
  const normalized = String(scriptPath || '').trim().replace(/\\/g, '/');
  return normalized.startsWith('tools/config/')
    || normalized.startsWith('tools/cli/')
    || normalized.startsWith('tools/tooling/')
    || normalized.startsWith('tools/tui/')
    || normalized.startsWith('tools/reports/')
    || normalized.startsWith('tools/bench/')
    || normalized === 'tools/mcp/server.js'
    || normalized === 'tools/build/compact-sqlite-index.js';
}

/**
 * Check whether token requests CLI help output.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isHelpCommand(value) {
  return value === 'help' || value === '--help' || value === '-h';
}

/**
 * Check whether token requests CLI version output.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isVersionCommand(value) {
  return value === 'version' || value === '--version' || value === '-v';
}

function isHelpAllCommand(value) {
  return value === '--help-all' || value === 'help-all';
}

/**
 * Print top-level CLI command reference to stderr.
 *
 * @returns {void}
 */
function printHelp({ includeAll = false, topicTokens = [] } = {}) {
  const trimmedTopicTokens = topicTokens.map((value) => String(value || '').trim()).filter(Boolean);
  if (trimmedTopicTokens.length > 0) {
    printTopicHelp(trimmedTopicTokens, { includeAll });
    return;
  }
  const supportTiers = includeAll
    ? ['stable', 'operator', 'internal', 'experimental']
    : DEFAULT_HELP_SUPPORT_TIERS;
  const lines = ['Usage: pairofcleats <command> [args]', ''];
  lines.push('Use `pairofcleats help <topic>` for subcommands and examples.');
  if (!includeAll) {
    lines.push('Use `pairofcleats help --all` to reveal internal and experimental commands.');
  }
  lines.push('');

  const examples = listCommonWorkflowExamples({ supportTiers }).slice(0, 6);
  if (examples.length > 0) {
    lines.push('Common workflows:');
    for (const entry of examples) {
      lines.push(`  - ${entry.example}`);
    }
    lines.push('');
  }

  for (const tier of supportTiers) {
    const tierSections = listHelpSections({ supportTiers: [tier] });
    if (!tierSections.length) continue;
    lines.push(`${COMMAND_SUPPORT_TIER_LABELS[tier]} commands:`);
    const commandWidth = Math.max(
      ...tierSections.flatMap((section) => section.commands.map((entry) => entry.commandPath.join(' ').length)),
      0
    );
    for (const section of tierSections) {
      lines.push(`  ${section.group}:`);
      for (const entry of section.commands) {
        const commandLabel = entry.commandPath.join(' ');
        lines.push(`    ${commandLabel.padEnd(commandWidth)}  ${entry.description}`);
      }
    }
    lines.push('');
  }
  process.stderr.write(`${lines.join('\n')}\n`);
}

function printRequestedHelp(helpArgs) {
  const includeAll = helpArgs.includes('--all');
  const topicTokens = helpArgs.filter((arg) => arg !== '--all');
  printHelp({ includeAll, topicTokens });
}

function printTopicHelp(topicTokens, { includeAll = false } = {}) {
  const supportTiers = includeAll
    ? ['stable', 'operator', 'internal', 'experimental']
    : DEFAULT_HELP_SUPPORT_TIERS;
  const exactEntry = describeCommandRegistryEntry(topicTokens.join(' '));
  if (exactEntry && supportTiers.includes(exactEntry.supportTier)) {
    const lines = [
      `Command: pairofcleats ${exactEntry.commandPath.join(' ')}`,
      `Support tier: ${COMMAND_SUPPORT_TIER_LABELS[exactEntry.supportTier]}`,
      `Group: ${exactEntry.helpGroup}`,
      '',
      exactEntry.description
    ];
    if (exactEntry.helpExamples.length > 0) {
      lines.push('', 'Examples:');
      for (const example of exactEntry.helpExamples) {
        lines.push(`  - ${example}`);
      }
    }
    lines.push('', 'Pass `--help` after the command to inspect script-specific flags.');
    process.stderr.write(`${lines.join('\n')}\n`);
    return;
  }

  const topic = topicTokens[0];
  const matchingEntries = listCommandRegistry({ supportTiers })
    .filter((entry) => entry.commandPath[0] === topic);
  if (!matchingEntries.length) {
    failCli(`Unknown help topic: ${topicTokens.join(' ')}`, {
      code: ERROR_CODES.INVALID_REQUEST,
      showHelp: true
    });
  }

  const commandWidth = Math.max(
    ...matchingEntries.map((entry) => entry.commandPath.slice(1).join(' ').length || topic.length),
    0
  );
  const lines = [
    `Help topic: ${topic}`,
    '',
    'Subcommands:'
  ];
  for (const tier of supportTiers) {
    const entries = matchingEntries.filter((entry) => entry.supportTier === tier);
    if (!entries.length) continue;
    lines.push(`  ${COMMAND_SUPPORT_TIER_LABELS[tier]}:`);
    for (const entry of entries) {
      const subcommand = entry.commandPath.slice(1).join(' ') || topic;
      lines.push(`    ${subcommand.padEnd(commandWidth)}  ${entry.description}`);
    }
  }
  const examples = matchingEntries.flatMap((entry) => entry.helpExamples).slice(0, 4);
  if (examples.length > 0) {
    lines.push('', 'Examples:');
    for (const example of examples) {
      lines.push(`  - ${example}`);
    }
  }
  if (!includeAll) {
    const hidden = listCommandRegistry({ supportTiers: ['internal', 'experimental'] })
      .filter((entry) => entry.commandPath[0] === topic);
    if (hidden.length > 0) {
      lines.push('', 'Use `pairofcleats help --all` to reveal additional internal or experimental subcommands.');
    }
  }
  process.stderr.write(`${lines.join('\n')}\n`);
}

/**
 * Emit standardized CLI error payload and terminate process.
 *
 * @param {string} message
 * @param {{code?:string,hint?:string|null,showHelp?:boolean,exitCode?:number}} [options]
 * @returns {never}
 */
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
