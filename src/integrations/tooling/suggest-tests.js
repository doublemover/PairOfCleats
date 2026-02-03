import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../shared/cli.js';
import { isAbsolutePathNative, toPosix } from '../../shared/files.js';
import { buildSuggestTestsReport } from '../../graph/suggest-tests.js';
import { renderSuggestTestsReport } from '../../retrieval/output/suggest-tests.js';
import { validateSuggestTests } from '../../contracts/validators/analysis.js';
import { buildIndexSignature } from '../../retrieval/index-cache.js';
import { hasIndexMeta } from '../../retrieval/cli/index-loader.js';
import { resolveIndexDir } from '../../retrieval/cli-index.js';
import {
  MAX_JSON_BYTES,
  loadPiecesManifest,
  readCompatibilityKey
} from '../../shared/artifact-io.js';
import { createGraphStore } from '../../graph/store.js';
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

export async function runSuggestTestsCli(rawArgs = process.argv.slice(2)) {
  const cli = createCli({
    scriptName: 'suggest-tests',
    argv: ['node', 'suggest-tests', ...rawArgs],
    options: {
      repo: { type: 'string' },
      changed: { type: 'array' },
      changedFile: { type: 'string' },
      max: { type: 'number' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      testPattern: { type: 'array' },
      maxDepth: { type: 'number' },
      maxNodes: { type: 'number' },
      maxEdges: { type: 'number' },
      maxPaths: { type: 'number' },
      maxCandidates: { type: 'number' },
      maxWorkUnits: { type: 'number' },
      maxWallClockMs: { type: 'number' }
    },
    aliases: {
      'test-pattern': 'testPattern',
      'changed-file': 'changedFile'
    }
  });
  const argv = cli.parse();

  if (!Number.isFinite(argv.max)) {
    throw new Error('Missing --max <n>.');
  }

  const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
  const format = resolveFormat(argv);
  const userConfig = loadUserConfig(repoRoot);
  const indexDir = resolveIndexDir(repoRoot, 'code', userConfig);
  if (!hasIndexMeta(indexDir)) {
    throw new Error(`Code index not found at ${indexDir}.`);
  }

  const changed = parseChangedInputs({ changed: argv.changed, changedFile: argv.changedFile }, repoRoot);
  const baseCaps = userConfig?.retrieval?.graph?.caps || {};
  const capOverrides = {
    maxDepth: normalizeOptionalNumber(argv.maxDepth),
    maxNodes: normalizeOptionalNumber(argv.maxNodes),
    maxEdges: normalizeOptionalNumber(argv.maxEdges),
    maxPaths: normalizeOptionalNumber(argv.maxPaths),
    maxCandidates: normalizeOptionalNumber(argv.maxCandidates),
    maxWorkUnits: normalizeOptionalNumber(argv.maxWorkUnits),
    maxWallClockMs: normalizeOptionalNumber(argv.maxWallClockMs),
    maxSuggestions: normalizeOptionalNumber(argv.max)
  };
  const caps = mergeCaps(baseCaps, capOverrides);

  const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
  const graphStore = createGraphStore({ indexDir, manifest, strict: true, maxBytes: MAX_JSON_BYTES });
  const graphRelations = graphStore.hasArtifact('graph_relations')
    ? await graphStore.loadGraph()
    : null;

  const { key: indexCompatKey } = readCompatibilityKey(indexDir, {
    maxBytes: MAX_JSON_BYTES,
    strict: true
  });
  const indexSignature = buildIndexSignature(indexDir);

  const report = buildSuggestTestsReport({
    changed,
    graphRelations,
    repoRoot,
    testPatterns: argv.testPattern,
    caps,
    indexCompatKey: indexCompatKey || null,
    indexSignature: indexSignature || null,
    repo: toPosix(path.relative(process.cwd(), repoRoot) || '.'),
    indexDir: toPosix(path.relative(process.cwd(), indexDir) || '.')
  });

  const validation = validateSuggestTests(report);
  if (!validation.ok) {
    throw new Error(`Suggest-tests schema validation failed: ${validation.errors.join('; ')}`);
  }

  if (format === 'md') {
    console.log(renderSuggestTestsReport(report));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSuggestTestsCli().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
