import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { parseSeedRef } from '../../shared/seed-ref.js';
import { assembleCompositeContextPack, buildChunkIndex } from '../../context-pack/assemble.js';
import { renderCompositeContextPack } from '../../retrieval/output/composite-context-pack.js';
import { validateCompositeContextPack } from '../../contracts/validators/analysis.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import {
  MAX_JSON_BYTES,
  loadPiecesManifest,
  readCompatibilityKey,
  loadChunkMeta
} from '../../shared/artifact-io.js';
import { buildGraphIndexCacheKey, createGraphStore } from '../../graph/store.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/shared/dict-utils.js';

const resolveFormat = (argv) => {
  const formatRaw = argv.format || (argv.json ? 'json' : 'json');
  const format = String(formatRaw).trim().toLowerCase();
  if (format === 'md' || format === 'markdown') return 'md';
  return 'json';
};

const mergeCaps = (baseCaps, overrides) => {
  const merged = { ...(baseCaps || {}) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) continue;
    merged[key] = value;
  }
  return merged;
};

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

    const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
    const chunkMeta = await loadChunkMeta(indexDir, { maxBytes: MAX_JSON_BYTES, manifest, strict: true });
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

    const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
      maxBytes: MAX_JSON_BYTES,
      strict: true
    });
    const indexSignature = await buildIndexSignature(indexDir);
    const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
    const graphList = [];
    if (argv.includeCallersCallees !== false) graphList.push('callGraph');
    if (argv.includeUsages !== false) graphList.push('usageGraph');
    if (argv.includeImports !== false) graphList.push('importGraph');
    const includeCsr = graphStore.hasArtifact('graph_relations_csr');
    const graphCacheKey = buildGraphIndexCacheKey({
      indexSignature,
      repoRoot,
      graphs: graphList,
      includeCsr
    });
    const graphIndex = (argv.includeGraph !== false)
      ? await graphStore.loadGraphIndex({
        repoRoot,
        cacheKey: graphCacheKey,
        graphs: graphList,
        includeCsr
      })
      : null;

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
      indexCompatKey: indexCompatKey || null,
      indexSignature: indexSignature || null,
      repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
      indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
    });

    const validation = validateCompositeContextPack(payload);
    if (!validation.ok) {
      throw new Error(`CompositeContextPack schema validation failed: ${validation.errors.join('; ')}`);
    }

    if (format === 'md') {
      console.log(renderCompositeContextPack(payload));
      return payload;
    }

    console.log(JSON.stringify(payload, null, 2));
    return payload;
  } catch (err) {
    const message = err?.message || String(err);
    if (format === 'json') {
      console.log(JSON.stringify({ ok: false, code: 'ERR_CONTEXT_PACK', message }, null, 2));
    } else {
      console.error(message);
    }
    return { ok: false, code: 'ERR_CONTEXT_PACK', message };
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
