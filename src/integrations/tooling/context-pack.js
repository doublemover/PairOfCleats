import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { parseSeedRef } from '../../shared/seed-ref.js';
import { normalizeRiskFilters, validateRiskFilters } from '../../shared/risk-filters.js';
import { emitCliError, emitCliOutput, mergeCaps, resolveFormat } from './cli-helpers.js';
import { assembleCompositeContextPack, buildChunkIndex } from '../../context-pack/assemble.js';
import { renderCompositeContextPack, renderCompositeContextPackJson } from '../../retrieval/output/composite-context-pack.js';
import { validateCompositeContextPack } from '../../contracts/validators/analysis.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import { prepareGraphIndex, prepareGraphInputs } from './graph-helpers.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/shared/dict-utils.js';

const buildRiskFilterInput = (input = {}) => ({
  rule: input.rule,
  category: input.category,
  severity: input.severity,
  tag: input.tag,
  source: input.source,
  sink: input.sink,
  flowId: input.flowId ?? input.flow_id ?? input['flow-id'],
  sourceRule: input.sourceRule ?? input.source_rule ?? input['source-rule'],
  sinkRule: input.sinkRule ?? input.sink_rule ?? input['sink-rule']
});

const createContextPackRequestError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

/**
 * Build a composite context-pack payload using the shared CLI/runtime assembly.
 *
 * This is the authoritative cross-surface path for CLI, API, and MCP so seed
 * parsing, risk-filter validation, graph preparation, and empty-result
 * behavior stay aligned.
 *
 * @param {{
 *   repoRoot?:string,
 *   seed:string|object,
 *   hops:number,
 *   includeGraph?:boolean,
 *   includeTypes?:boolean,
 *   includeRisk?:boolean,
 *   includeRiskPartialFlows?:boolean,
 *   strictRisk?:boolean,
 *   riskFilters?:object|null,
 *   includeImports?:boolean,
 *   includeUsages?:boolean,
 *   includeCallersCallees?:boolean,
 *   includePaths?:boolean,
 *   maxBytes?:number|null,
 *   maxTokens?:number|null,
 *   maxTypeEntries?:number|null,
 *   maxDepth?:number|null,
 *   maxFanoutPerNode?:number|null,
 *   maxNodes?:number|null,
 *   maxEdges?:number|null,
 *   maxPaths?:number|null,
 *   maxCandidates?:number|null,
 *   maxWorkUnits?:number|null,
 *   maxWallClockMs?:number|null
 * }} [input]
 * @returns {Promise<object>}
 */
export async function buildCompositeContextPackPayload(input = {}) {
  const repoRoot = input.repoRoot ? path.resolve(input.repoRoot) : resolveRepoRoot(process.cwd());
  if (!input.seed) {
    throw createContextPackRequestError('ERR_CONTEXT_PACK_INVALID_REQUEST', 'Missing seed.', 400);
  }
  if (!Number.isFinite(Number(input.hops))) {
    throw createContextPackRequestError('ERR_CONTEXT_PACK_INVALID_REQUEST', 'Missing hops.', 400);
  }

  const riskFilters = normalizeRiskFilters(buildRiskFilterInput(input.riskFilters || {}));
  const filterValidation = validateRiskFilters(riskFilters);
  if (!filterValidation.ok) {
    throw createContextPackRequestError(
      'ERR_CONTEXT_PACK_RISK_FILTER_INVALID',
      `Invalid risk filters: ${filterValidation.errors.join('; ')}`,
      400
    );
  }

  const seed = typeof input.seed === 'string'
    ? parseSeedRef(input.seed, repoRoot)
    : input.seed;
  const userConfig = loadUserConfig(repoRoot);
  const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw createContextPackRequestError('ERR_CONTEXT_PACK_NO_INDEX', `Code index not found at ${indexDir}.`, 404);
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
    maxDepth: normalizeOptionalNumber(input.maxDepth),
    maxFanoutPerNode: normalizeOptionalNumber(input.maxFanoutPerNode),
    maxNodes: normalizeOptionalNumber(input.maxNodes),
    maxEdges: normalizeOptionalNumber(input.maxEdges),
    maxPaths: normalizeOptionalNumber(input.maxPaths),
    maxCandidates: normalizeOptionalNumber(input.maxCandidates),
    maxWorkUnits: normalizeOptionalNumber(input.maxWorkUnits),
    maxWallClockMs: normalizeOptionalNumber(input.maxWallClockMs)
  };
  const caps = mergeCaps(baseCaps, capOverrides);

  const graphList = [];
  if (input.includeCallersCallees !== false) graphList.push('callGraph');
  if (input.includeUsages !== false) graphList.push('usageGraph');
  if (input.includeImports !== false) graphList.push('importGraph');
  const { graphIndex } = await prepareGraphIndex({
    repoRoot,
    indexDir,
    selection: graphList,
    strict: true,
    graphInputs,
    includeGraphIndex: input.includeGraph !== false
  });

  const payload = assembleCompositeContextPack({
    seed,
    chunkMeta,
    chunkIndex,
    repoRoot,
    graphIndex,
    includeGraph: input.includeGraph !== false,
    includeTypes: input.includeTypes === true,
    includeRisk: input.includeRisk === true,
    includeRiskPartialFlows: input.includeRiskPartialFlows === true,
    riskStrict: input.strictRisk === true,
    riskFilters,
    includeImports: input.includeImports !== false,
    includeUsages: input.includeUsages !== false,
    includeCallersCallees: input.includeCallersCallees !== false,
    includePaths: input.includePaths === true,
    depth: Math.max(0, Math.floor(Number(input.hops))),
    maxBytes: normalizeOptionalNumber(input.maxBytes),
    maxTokens: normalizeOptionalNumber(input.maxTokens),
    maxTypeEntries: normalizeOptionalNumber(input.maxTypeEntries),
    caps,
    indexCompatKey: graphInputs.indexCompatKey || null,
    indexSignature: graphInputs.indexSignature || null,
    repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
    indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
  });

  const validation = validateCompositeContextPack(payload);
  if (!validation.ok) {
    throw createContextPackRequestError(
      'ERR_CONTEXT_PACK_SCHEMA',
      `CompositeContextPack schema validation failed: ${validation.errors.join('; ')}`,
      500
    );
  }

  return payload;
}

/**
 * CLI entrypoint for composite context-pack generation.
 *
 * Parses seed-centric context options, resolves graph/index dependencies, and
 * emits a contract-validated `CompositeContextPack` report.
 *
 * @param {string[]} [rawArgs]
 * @returns {Promise<{ok:boolean,code?:string,payload?:object,message?:string}>}
 */
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
      includeRiskPartialFlows: { type: 'boolean', default: false },
      strictRisk: { type: 'boolean', default: false },
      rule: { type: 'string' },
      category: { type: 'string' },
      severity: { type: 'string' },
      tag: { type: 'string' },
      source: { type: 'string' },
      sink: { type: 'string' },
      'flow-id': { type: 'string' },
      'source-rule': { type: 'string' },
      'sink-rule': { type: 'string' },
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
    const payload = await buildCompositeContextPackPayload({
      repoRoot,
      seed: argv.seed,
      hops: argv.hops,
      includeGraph: argv.includeGraph,
      includeTypes: argv.includeTypes,
      includeRisk: argv.includeRisk,
      includeRiskPartialFlows: argv.includeRiskPartialFlows,
      strictRisk: argv.strictRisk,
      riskFilters: buildRiskFilterInput(argv),
      includeImports: argv.includeImports,
      includeUsages: argv.includeUsages,
      includeCallersCallees: argv.includeCallersCallees,
      includePaths: argv.includePaths,
      maxBytes: argv.maxBytes,
      maxTokens: argv.maxTokens,
      maxTypeEntries: argv.maxTypeEntries,
      maxDepth: argv.maxDepth,
      maxFanoutPerNode: argv.maxFanoutPerNode,
      maxNodes: argv.maxNodes,
      maxEdges: argv.maxEdges,
      maxPaths: argv.maxPaths,
      maxCandidates: argv.maxCandidates,
      maxWorkUnits: argv.maxWorkUnits,
      maxWallClockMs: argv.maxWallClockMs
    });

    return emitCliOutput({
      format,
      payload,
      renderMarkdown: renderCompositeContextPack,
      renderJson: renderCompositeContextPackJson
    });
  } catch (err) {
    const message = err?.message || String(err);
    return emitCliError({ format, code: err?.code || 'ERR_CONTEXT_PACK', message });
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
