import path from 'node:path';
import { createCli } from '../../shared/cli.js';
import { isDirectExecution } from '../../shared/direct-execution.js';
import { toPosix } from '../../shared/file-paths.js';
import { parseSeedRef } from '../../shared/seed-ref.js';
import {
  buildGraphCliOptions,
  emitCliError,
  emitCliOutput,
  resolveFormat,
  resolveGraphCliCapsAndFilters
} from './cli-helpers.js';
import { buildGraphContextPack } from '../../graph/context-pack.js';
import { renderGraphContextPack } from '../../retrieval/output/graph-context-pack.js';
import { validateGraphContextPack } from '../../contracts/validators/analysis.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { prepareGraphIndex, prepareGraphInputs } from './graph-helpers.js';
import { loadUserConfig } from '../../shared/dict-utils.js';
import { getRepoRoot } from '../../shared/repo-paths.js';

/**
 * CLI entrypoint for graph-neighborhood context pack generation.
 *
 * Validates graph traversal arguments, applies graph filter/cap overrides, and
 * emits a schema-validated `GraphContextPack` payload.
 *
 * @param {string[]} [rawArgs]
 * @returns {Promise<{ok:boolean,code?:string,payload?:object,message?:string}>}
 */
export async function runGraphContextCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'graph-context',
    argv: ['node', 'graph-context', ...rawArgs],
    options: buildGraphCliOptions({
      seed: { type: 'string' },
      includePaths: { type: 'boolean', default: false }
    })
  });
  const argv = cli.parse();

  const repoRoot = getRepoRoot(argv.repo || null, process.cwd());
  const format = resolveFormat(argv);

  try {
    if (!argv.seed) throw new Error('Missing --seed <ref>.');
    if (!Number.isFinite(argv.depth)) throw new Error('Missing --depth <n>.');
    if (!argv.direction) throw new Error('Missing --direction <out|in|both>.');

    const direction = String(argv.direction).trim().toLowerCase();
    if (!['out', 'in', 'both'].includes(direction)) {
      throw new Error('Invalid --direction value. Use out|in|both.');
    }

    const userConfig = loadUserConfig(repoRoot);
    const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
    if (!hasIndexMeta(indexDir)) {
      throw new Error(`Code index not found at ${indexDir}.`);
    }

    const seed = parseSeedRef(argv.seed, repoRoot);
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

    const pack = buildGraphContextPack({
      seed,
      graphIndex,
      direction,
      depth: Math.max(0, Math.floor(Number(argv.depth))),
      edgeFilters,
      caps,
      includePaths: argv.includePaths === true,
      indexCompatKey: graphInputs.indexCompatKey || null,
      indexSignature: graphInputs.indexSignature || null,
      repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
      indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
    });

    const validation = validateGraphContextPack(pack);
    if (!validation.ok) {
      throw new Error(`GraphContextPack schema validation failed: ${validation.errors.join('; ')}`);
    }

    return emitCliOutput({
      format,
      payload: pack,
      renderMarkdown: renderGraphContextPack
    });
  } catch (err) {
    const message = err?.message || String(err);
    return emitCliError({ format, code: 'ERR_GRAPH_CONTEXT', message });
  }
}

if (isDirectExecution(import.meta.url)) {
  runGraphContextCli()
    .then((result) => {
      if (result?.ok === false) process.exit(1);
    })
    .catch((err) => {
      console.error(err?.message || err);
      process.exit(1);
    });
}
