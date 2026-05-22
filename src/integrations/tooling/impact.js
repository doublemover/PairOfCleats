import path from 'node:path';
import { createCli } from '../../shared/cli.js';
import { isDirectExecution } from '../../shared/direct-execution.js';
import { toPosix } from '../../shared/file-paths.js';
import { parseSeedRef } from '../../shared/seed-ref.js';
import {
  buildGraphCliOptions,
  emitCliError,
  emitCliOutput,
  parseChangedInputs,
  resolveFormat,
  resolveGraphCliCapsAndFilters
} from './cli-helpers.js';
import { buildImpactAnalysis, IMPACT_EMPTY_CHANGED_SET_CODE } from '../../graph/impact.js';
import { renderGraphImpact } from '../../retrieval/output/graph-impact.js';
import { validateGraphImpact } from '../../contracts/validators/analysis.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { prepareGraphIndex, prepareGraphInputs } from './graph-helpers.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { getRepoRoot } from '../../shared/repo-paths.js';

const createImpactInputError = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/**
 * CLI entrypoint for graph impact analysis.
 *
 * Enforces seed/changed input requirements, resolves graph caps/filters, loads
 * graph index artifacts, and emits a validated `GraphImpact` payload in JSON or
 * markdown formats.
 *
 * @param {string[]} [rawArgs]
 * @returns {Promise<{ok:boolean,code?:string,payload?:object,message?:string}>}
 */
export async function runImpactCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'impact',
    argv: ['node', 'impact', ...rawArgs],
    options: buildGraphCliOptions({
      seed: { type: 'string' },
      changed: { type: 'array' },
      changedFile: { type: 'string' }
    })
  });
  const argv = cli.parse();

  const repoRoot = getRepoRoot(argv.repo || null, process.cwd());
  const format = resolveFormat(argv);

  try {
    if (!Number.isFinite(argv.depth)) throw new Error('Missing --depth <n>.');
    if (!argv.direction) throw new Error('Missing --direction <upstream|downstream>.');

    const direction = String(argv.direction).trim().toLowerCase();
    if (!['upstream', 'downstream'].includes(direction)) {
      throw new Error('Invalid --direction value. Use upstream|downstream.');
    }

    const seed = argv.seed ? parseSeedRef(argv.seed, repoRoot) : null;
    const changed = parseChangedInputs({ changed: argv.changed, changedFile: argv.changedFile }, repoRoot);
    if (!seed && changed.length === 0) {
      throw createImpactInputError(
        IMPACT_EMPTY_CHANGED_SET_CODE,
        'No changed paths provided. Supply --changed/--changed-file or --seed.'
      );
    }

    const userConfig = loadUserConfig(repoRoot);
    const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
    if (!hasIndexMeta(indexDir)) {
      throw new Error(`Code index not found at ${indexDir}.`);
    }

    const { caps, edgeFilters, graphSelection } = resolveGraphCliCapsAndFilters(argv, userConfig);

    const graphInputs = await prepareGraphInputs({
      repoRoot,
      indexDir,
      strict: true
    });
    const { graphIndex } = await prepareGraphIndex({
      repoRoot,
      indexDir,
      selection: graphSelection,
      strict: true,
      graphInputs
    });

    const payload = buildImpactAnalysis({
      seed,
      changed: seed ? null : changed,
      graphIndex,
      direction,
      depth: Math.max(0, Math.floor(Number(argv.depth))),
      edgeFilters,
      caps,
      indexCompatKey: graphInputs.indexCompatKey || null,
      indexSignature: graphInputs.indexSignature || null,
      repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
      indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
    });
    if (seed && changed.length) {
      const warning = {
        code: 'CHANGED_IGNORED',
        message: 'Changed inputs are ignored when --seed is provided.'
      };
      if (Array.isArray(payload.warnings)) {
        payload.warnings.push(warning);
      } else {
        payload.warnings = [warning];
      }
    }

    const validation = validateGraphImpact(payload);
    if (!validation.ok) {
      throw new Error(`GraphImpact schema validation failed: ${validation.errors.join('; ')}`);
    }

    return emitCliOutput({
      format,
      payload,
      renderMarkdown: renderGraphImpact
    });
  } catch (err) {
    const message = err?.message || String(err);
    const code = err?.code === IMPACT_EMPTY_CHANGED_SET_CODE
      ? IMPACT_EMPTY_CHANGED_SET_CODE
      : 'ERR_GRAPH_IMPACT';
    return emitCliError({ format, code, message });
  }
}

if (isDirectExecution(import.meta.url)) {
  runImpactCli()
    .then((result) => {
      if (result?.ok === false) process.exit(1);
    })
    .catch((err) => {
      console.error(err?.message || err);
      process.exit(1);
    });
}
