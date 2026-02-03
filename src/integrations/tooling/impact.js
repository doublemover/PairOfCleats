import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { isAbsolutePathNative, toPosix } from '../../shared/files.js';
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
import { createGraphStore } from '../../graph/store.js';
import { loadUserConfig, resolveRepoRoot } from '../../../tools/dict-utils.js';

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

const normalizeOptionalNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const resolveFormat = (argv) => {
  const formatRaw = argv.format || (argv.json ? 'json' : 'json');
  const format = String(formatRaw).trim().toLowerCase();
  if (format === 'md' || format === 'markdown') return 'md';
  return 'json';
};

const parseSeedRef = (raw, repoRoot) => {
  const value = String(raw || '').trim();
  if (!value) throw new Error('Missing --seed value.');
  const match = /^(chunk|symbol|file):(.+)$/.exec(value);
  if (!match) {
    throw new Error('Invalid --seed value. Use chunk:<id>, symbol:<id>, or file:<path>.');
  }
  const type = match[1];
  const suffix = match[2].trim();
  if (!suffix) throw new Error('Invalid --seed value.');
  if (type === 'chunk') return { type: 'chunk', chunkUid: suffix };
  if (type === 'symbol') return { type: 'symbol', symbolId: suffix };
  if (type === 'file') {
    const abs = isAbsolutePathNative(suffix) ? suffix : path.resolve(repoRoot, suffix);
    const rel = path.relative(repoRoot, abs);
    if (!rel || rel.startsWith('..') || isAbsolutePathNative(rel)) {
      throw new Error('file: seeds must resolve to a repo-relative path.');
    }
    return { type: 'file', path: toPosix(rel) };
  }
  throw new Error('Unsupported --seed type.');
};

const resolveRepoRelativePath = (raw, repoRoot) => {
  const value = String(raw || '').trim();
  if (!value) return null;
  const abs = isAbsolutePathNative(value) ? value : path.resolve(repoRoot, value);
  const rel = path.relative(repoRoot, abs);
  if (!rel || rel.startsWith('..') || isAbsolutePathNative(rel)) return null;
  return toPosix(rel);
};

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
    const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
    const graphRelations = graphStore.hasArtifact('graph_relations')
      ? await graphStore.loadGraph()
      : null;
    const symbolEdges = graphStore.hasArtifact('symbol_edges')
      ? await graphStore.loadSymbolEdges()
      : null;
    const callSites = graphStore.hasArtifact('call_sites')
      ? await graphStore.loadCallSites()
      : null;

    const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
      maxBytes: MAX_JSON_BYTES,
      strict: true
    });
    const indexSignature = buildIndexSignature(indexDir);

    const payload = buildImpactAnalysis({
      seed,
      changed: seed ? null : changed,
      graphRelations,
      symbolEdges,
      callSites,
      direction,
      depth: Math.max(0, Math.floor(Number(argv.depth))),
      edgeFilters,
      caps,
      indexCompatKey: indexCompatKey || null,
      indexSignature: indexSignature || null,
      repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
      indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
    });

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
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runImpactCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
