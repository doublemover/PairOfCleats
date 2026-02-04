import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { parseSeedRef } from '../../shared/seed-ref.js';
import { buildGraphContextPack } from '../../graph/context-pack.js';
import { renderGraphContextPack } from '../../retrieval/output/graph-context-pack.js';
import { validateGraphContextPack } from '../../contracts/validators/analysis.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import {
  MAX_JSON_BYTES,
  loadPiecesManifest,
  readCompatibilityKey
} from '../../shared/artifact-io.js';
import { buildGraphIndexCacheKey, createGraphStore } from '../../graph/store.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/shared/dict-utils.js';

const parseList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).map((entry) => entry.trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

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

export async function runGraphContextCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'graph-context',
    argv: ['node', 'graph-context', ...rawArgs],
    options: {
      repo: { type: 'string' },
      seed: { type: 'string' },
      depth: { type: 'number' },
      direction: { type: 'string' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      includePaths: { type: 'boolean', default: false },
      graphs: { type: 'string' },
      edgeTypes: { type: 'string' },
      minConfidence: { type: 'number' },
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

    const graphs = parseList(argv.graphs);
    const edgeTypes = parseList(argv.edgeTypes);
    const includeAllGraphs = graphs.length === 0;
    const minConfidence = normalizeOptionalNumber(argv.minConfidence);
    const edgeFilters = {
      graphs: graphs.length ? graphs : null,
      edgeTypes: edgeTypes.length ? edgeTypes : null,
      minConfidence
    };

    const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
    const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
      maxBytes: MAX_JSON_BYTES,
      strict: true
    });
    const indexSignature = await buildIndexSignature(indexDir);
    const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
    const graphSelection = includeAllGraphs ? null : graphs;
    const graphCacheKey = buildGraphIndexCacheKey({
      indexSignature,
      repoRoot,
      graphs: graphSelection
    });
    const graphIndex = await graphStore.loadGraphIndex({
      repoRoot,
      cacheKey: graphCacheKey,
      graphs: graphSelection
    });

    const pack = buildGraphContextPack({
      seed,
      graphIndex,
      direction,
      depth: Math.max(0, Math.floor(Number(argv.depth))),
      edgeFilters,
      caps,
      includePaths: argv.includePaths === true,
      indexCompatKey: indexCompatKey || null,
      indexSignature: indexSignature || null,
      repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
      indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
    });

    const validation = validateGraphContextPack(pack);
    if (!validation.ok) {
      throw new Error(`GraphContextPack schema validation failed: ${validation.errors.join('; ')}`);
    }

    if (format === 'md') {
      console.log(renderGraphContextPack(pack));
      return pack;
    }

    console.log(JSON.stringify(pack, null, 2));
    return pack;
  } catch (err) {
    const message = err?.message || String(err);
    if (format === 'json') {
      console.log(JSON.stringify({ ok: false, code: 'ERR_GRAPH_CONTEXT', message }, null, 2));
    } else {
      console.error(message);
    }
    return { ok: false, code: 'ERR_GRAPH_CONTEXT', message };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runGraphContextCli()
    .then((result) => {
      if (result?.ok === false) process.exit(1);
    })
    .catch((err) => {
      console.error(err?.message || err);
      process.exit(1);
    });
}
