import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { toPosix } from '../../shared/files.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { normalizeRepoRelativePath } from '../../shared/path-normalize.js';
import { parseSeedRef } from '../../shared/seed-ref.js';
import { buildImpactAnalysis } from '../../graph/impact.js';
import { renderGraphImpact } from '../../retrieval/output/graph-impact.js';
import { validateGraphImpact } from '../../contracts/validators/analysis.js';
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

const resolveRepoRelativePath = (raw, repoRoot) => (
  normalizeRepoRelativePath(raw, repoRoot)
);

const parseChangedInputs = ({ changed, changedFile }, repoRoot) => {
  const entries = [];
  for (const item of parseList(changed)) {
    entries.push(item);
  }
  if (changedFile) {
    const contents = fs.readFileSync(String(changedFile), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) entries.push(trimmed);
    }
  }
  const resolved = [];
  for (const entry of entries) {
    const rel = resolveRepoRelativePath(entry, repoRoot);
    if (!rel) continue;
    resolved.push(rel);
  }
  return resolved;
};

const mergeCaps = (baseCaps, overrides) => {
  const merged = { ...(baseCaps || {}) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) continue;
    merged[key] = value;
  }
  return merged;
};

export async function runImpactCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'impact',
    argv: ['node', 'impact', ...rawArgs],
    options: {
      repo: { type: 'string' },
      seed: { type: 'string' },
      changed: { type: 'array' },
      changedFile: { type: 'string' },
      depth: { type: 'number' },
      direction: { type: 'string' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
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
    if (!Number.isFinite(argv.depth)) throw new Error('Missing --depth <n>.');
    if (!argv.direction) throw new Error('Missing --direction <upstream|downstream>.');

    const direction = String(argv.direction).trim().toLowerCase();
    if (!['upstream', 'downstream'].includes(direction)) {
      throw new Error('Invalid --direction value. Use upstream|downstream.');
    }

    const userConfig = loadUserConfig(repoRoot);
    const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
    if (!hasIndexMeta(indexDir)) {
      throw new Error(`Code index not found at ${indexDir}.`);
    }

    const seed = argv.seed ? parseSeedRef(argv.seed, repoRoot) : null;
    const changed = parseChangedInputs({ changed: argv.changed, changedFile: argv.changedFile }, repoRoot);

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
    const graphSelection = graphs.length ? graphs : null;
    const includeCsr = graphStore.hasArtifact('graph_relations_csr');
    const graphCacheKey = buildGraphIndexCacheKey({
      indexSignature,
      repoRoot,
      graphs: graphSelection,
      includeCsr
    });
    const graphIndex = await graphStore.loadGraphIndex({
      repoRoot,
      cacheKey: graphCacheKey,
      graphs: graphSelection,
      includeCsr
    });

    const payload = buildImpactAnalysis({
      seed,
      changed: seed ? null : changed,
      graphIndex,
      direction,
      depth: Math.max(0, Math.floor(Number(argv.depth))),
      edgeFilters,
      caps,
      indexCompatKey: indexCompatKey || null,
      indexSignature: indexSignature || null,
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

    if (format === 'md') {
      console.log(renderGraphImpact(payload));
      return payload;
    }

    console.log(JSON.stringify(payload, null, 2));
    return payload;
  } catch (err) {
    const message = err?.message || String(err);
    if (format === 'json') {
      console.log(JSON.stringify({ ok: false, code: 'ERR_GRAPH_IMPACT', message }, null, 2));
    } else {
      console.error(message);
    }
    return { ok: false, code: 'ERR_GRAPH_IMPACT', message };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runImpactCli()
    .then((result) => {
      if (result?.ok === false) process.exit(1);
    })
    .catch((err) => {
      console.error(err?.message || err);
      process.exit(1);
    });
}
