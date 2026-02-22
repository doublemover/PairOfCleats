import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { parseSeedRef } from '../../shared/seed-ref.js';
import { emitCliError, emitCliOutput, mergeCaps, resolveFormat } from './cli-helpers.js';
import { assembleCompositeContextPack, buildChunkIndex } from '../../context-pack/assemble.js';
import { renderCompositeContextPack } from '../../retrieval/output/composite-context-pack.js';
import { validateCompositeContextPack } from '../../contracts/validators/analysis.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { prepareGraphIndex, prepareGraphInputs } from './graph-helpers.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/shared/dict-utils.js';

export async function runContextPackCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'context-pack',
    argv: ['node', 'context-pack', ...rawArgs],
    options: {
      repo: { type: 'string' },
      seed: { type: 'string' },
      hops: { type: 'number' },
      maxTokens: { type: 'number' },
      maxBytes: { type: 'number' },
      includeGraph: { type: 'boolean', default: true },
      includeTypes: { type: 'boolean', default: false },
      includeRisk: { type: 'boolean', default: false },
      includeImports: { type: 'boolean', default: true },
      includeUsages: { type: 'boolean', default: true },
      includeCallersCallees: { type: 'boolean', default: true },
      includePaths: { type: 'boolean', default: false },
      maxTypeEntries: { type: 'number' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      maxDepth: { type: 'number' },
      maxFanoutPerNode: { type: 'number' },
      maxNodes: { type: 'number' },
      maxEdges: { type: 'number' },
      maxPaths: { type: 'number' },
      maxCandidates: { type: 'number' },
      maxWorkUnits: { type: 'number' },
      maxWallClockMs: { type: 'number' }
    }
  });
  const argv = cli.parse();

  const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
  const format = resolveFormat(argv);

  try {
    if (!argv.seed) throw new Error('Missing --seed <ref>.');
    if (!Number.isFinite(argv.hops)) throw new Error('Missing --hops <n>.');

    const seed = parseSeedRef(argv.seed, repoRoot);
    const userConfig = loadUserConfig(repoRoot);
    const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
    if (!hasIndexMeta(indexDir)) {
      throw new Error(`Code index not found at ${indexDir}.`);
    }

    const graphInputs = await prepareGraphInputs({
      repoRoot,
      indexDir,
      strict: true,
      includeChunkMeta: true
    });
    const chunkMeta = graphInputs.chunkMeta;
    const chunkIndex = buildChunkIndex(chunkMeta, { repoRoot });

    const baseCaps = userConfig?.retrieval?.graph?.caps || {};
    const capOverrides = {
      maxDepth: normalizeOptionalNumber(argv.maxDepth),
      maxFanoutPerNode: normalizeOptionalNumber(argv.maxFanoutPerNode),
      maxNodes: normalizeOptionalNumber(argv.maxNodes),
      maxEdges: normalizeOptionalNumber(argv.maxEdges),
      maxPaths: normalizeOptionalNumber(argv.maxPaths),
      maxCandidates: normalizeOptionalNumber(argv.maxCandidates),
      maxWorkUnits: normalizeOptionalNumber(argv.maxWorkUnits),
      maxWallClockMs: normalizeOptionalNumber(argv.maxWallClockMs)
    };
    const caps = mergeCaps(baseCaps, capOverrides);

    const graphList = [];
    if (argv.includeCallersCallees !== false) graphList.push('callGraph');
    if (argv.includeUsages !== false) graphList.push('usageGraph');
    if (argv.includeImports !== false) graphList.push('importGraph');
    const { graphIndex } = await prepareGraphIndex({
      repoRoot,
      indexDir,
      selection: graphList,
      strict: true,
      graphInputs,
      includeGraphIndex: argv.includeGraph !== false
    });

    const payload = assembleCompositeContextPack({
      seed,
      chunkMeta,
      chunkIndex,
      repoRoot,
      graphIndex,
      includeGraph: argv.includeGraph !== false,
      includeTypes: argv.includeTypes === true,
      includeRisk: argv.includeRisk === true,
      includeImports: argv.includeImports !== false,
      includeUsages: argv.includeUsages !== false,
      includeCallersCallees: argv.includeCallersCallees !== false,
      includePaths: argv.includePaths === true,
      depth: Math.max(0, Math.floor(Number(argv.hops))),
      maxBytes: normalizeOptionalNumber(argv.maxBytes),
      maxTokens: normalizeOptionalNumber(argv.maxTokens),
      maxTypeEntries: normalizeOptionalNumber(argv.maxTypeEntries),
      caps,
      indexCompatKey: graphInputs.indexCompatKey || null,
      indexSignature: graphInputs.indexSignature || null,
      repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
      indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
    });

    const validation = validateCompositeContextPack(payload);
    if (!validation.ok) {
      throw new Error(`CompositeContextPack schema validation failed: ${validation.errors.join('; ')}`);
    }

    return emitCliOutput({
      format,
      payload,
      renderMarkdown: renderCompositeContextPack
    });
  } catch (err) {
    const message = err?.message || String(err);
    return emitCliError({ format, code: 'ERR_CONTEXT_PACK', message });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runContextPackCli()
    .then((result) => {
      if (result?.ok === false) process.exit(1);
    })
    .catch((err) => {
      console.error(err?.message || err);
      process.exit(1);
    });
}
