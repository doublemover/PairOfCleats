#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { checksumFile } from '../../src/shared/hash.js';
import { formatBytes } from '../../src/shared/disk-space.js';
import { loadPiecesManifest } from '../../src/shared/artifact-io.js';
import { fromPosix, isRelativePathEscape } from '../../src/shared/files.js';
import { getRepoId, loadUserConfig, resolveIndexRoot, resolveRepoRootArg } from '../shared/dict-utils.js';

const MODE_ORDER = ['code', 'prose', 'extracted-prose', 'records'];
const SCHEMA_VERSION = 1;
const REQUIRED_VERIFY_FAMILIES = Object.freeze([
  {
    label: 'chunk_meta',
    match: (piece) => String(piece?.name || '').startsWith('chunk_meta')
  },
  {
    label: 'token_postings',
    match: (piece) => String(piece?.name || '').startsWith('token_postings')
  }
]);

const argv = createCli({
  scriptName: 'index-stats',
  options: {
    repo: { type: 'string' },
    'index-dir': { type: 'string' },
    mode: { type: 'string' },
    json: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false }
  }
}).parse();

const normalizeMode = (value) => {
  if (typeof value !== 'string') return null;
  const mode = value.trim().toLowerCase();
  return MODE_ORDER.includes(mode) ? mode : null;
};

const normalizeCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
};

const parseChecksum = (value) => {
  if (typeof value !== 'string') return null;
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  return {
    algo: value.slice(0, separator),
    value: value.slice(separator + 1)
  };
};

const collectModeDirsFromRoot = (rootPath, modeFilter = null) => {
  if (!fsSync.existsSync(rootPath)) return [];
  const stat = fsSync.statSync(rootPath);
  if (!stat.isDirectory()) return [];
  const base = path.basename(rootPath);
  const directMode = base.startsWith('index-') ? base.slice('index-'.length) : null;
  if (directMode && MODE_ORDER.includes(directMode)) {
    if (modeFilter && directMode !== modeFilter) return [];
    return [{ mode: directMode, dir: path.resolve(rootPath) }];
  }
  const out = [];
  for (const mode of MODE_ORDER) {
    if (modeFilter && mode !== modeFilter) continue;
    const modeDir = path.join(rootPath, `index-${mode}`);
    if (!fsSync.existsSync(modeDir)) continue;
    if (!fsSync.statSync(modeDir).isDirectory()) continue;
    out.push({ mode, dir: path.resolve(modeDir) });
  }
  return out;
};

const selectModeDirs = () => {
  const modeFilter = normalizeMode(argv.mode);
  if (argv.mode && !modeFilter) {
    throw new Error(`Invalid --mode ${argv.mode}. Use ${MODE_ORDER.join('|')}.`);
  }
  if (argv.repo && argv['index-dir']) {
    throw new Error('Use either --repo or --index-dir, not both.');
  }
  if (!argv.repo && !argv['index-dir']) {
    throw new Error('index stats requires --repo <path> or --index-dir <path>.');
  }
  if (argv['index-dir']) {
    const indexRoot = path.resolve(String(argv['index-dir']));
    const modes = collectModeDirsFromRoot(indexRoot, modeFilter);
    if (!modes.length) {
      throw new Error(`No index directories found under ${indexRoot}.`);
    }
    return {
      source: 'index-dir',
      indexRoot,
      repoRoot: null,
      repoId: null,
      modes
    };
  }
  // Preserve explicit --repo paths as provided by the caller instead of
  // resolving to enclosing git/config roots.
  const repoRoot = resolveRepoRootArg(String(argv.repo));
  const userConfig = loadUserConfig(repoRoot);
  const indexRoot = resolveIndexRoot(repoRoot, userConfig, {});
  const modes = collectModeDirsFromRoot(indexRoot, modeFilter);
  if (!modes.length) {
    throw new Error(`No index directories found under ${indexRoot}.`);
  }
  return {
    source: 'repo',
    indexRoot,
    repoRoot,
    repoId: getRepoId(repoRoot),
    modes
  };
};

const buildFamilyStats = (pieces, {
  names,
  countFromName = null
}) => {
  const nameSet = new Set(names);
  const selected = pieces.filter((piece) => nameSet.has(String(piece?.name || '')));
  const bytes = selected.reduce((sum, piece) => sum + (Number(piece?.bytes) || 0), 0);
  const countCandidates = selected
    .filter((piece) => !countFromName || piece.name === countFromName)
    .map((piece) => normalizeCount(piece?.count))
    .filter((value) => value != null);
  return {
    rows: countCandidates.length ? Math.max(...countCandidates) : null,
    bytes
  };
};

const buildChunkStats = (pieces) => {
  const selected = pieces.filter((piece) => String(piece?.name || '').startsWith('chunk_meta'));
  const bytes = selected.reduce((sum, piece) => sum + (Number(piece?.bytes) || 0), 0);
  const rows = selected
    .map((piece) => normalizeCount(piece?.count))
    .filter((value) => value != null);
  const parts = selected.filter((piece) => String(piece?.path || '').includes('.part-')).length;
  return {
    rows: rows.length ? Math.max(...rows) : null,
    parts,
    bytes
  };
};

const buildTokenStats = (pieces) => {
  const selected = pieces.filter((piece) => String(piece?.name || '').startsWith('token_postings'));
  const bytes = selected.reduce((sum, piece) => sum + (Number(piece?.bytes) || 0), 0);
  const rows = selected
    .map((piece) => normalizeCount(piece?.count))
    .filter((value) => value != null);
  const parts = selected.filter((piece) => String(piece?.path || '').includes('.part-')).length;
  return {
    rows: rows.length ? Math.max(...rows) : null,
    parts,
    bytes
  };
};

const buildEmbeddingStats = (pieces) => {
  const densePieces = pieces.filter((piece) => (
    String(piece?.name || '').startsWith('dense_vectors')
    && !String(piece?.name || '').includes('hnsw')
    && !String(piece?.name || '').includes('lancedb')
  ));
  const hnswPieces = pieces.filter((piece) => String(piece?.name || '').includes('hnsw'));
  const lancedbPieces = pieces.filter((piece) => String(piece?.name || '').includes('lancedb'));
  const denseCountCandidates = densePieces
    .map((piece) => normalizeCount(piece?.count))
    .filter((value) => value != null);
  return {
    denseVectors: {
      count: denseCountCandidates.length ? Math.max(...denseCountCandidates) : null,
      bytes: densePieces.reduce((sum, piece) => sum + (Number(piece?.bytes) || 0), 0)
    },
    hnsw: {
      count: hnswPieces.length || null,
      bytes: hnswPieces.reduce((sum, piece) => sum + (Number(piece?.bytes) || 0), 0)
    },
    lancedb: {
      count: lancedbPieces.length || null,
      bytes: lancedbPieces.reduce((sum, piece) => sum + (Number(piece?.bytes) || 0), 0)
    }
  };
};

const verifyManifestPieces = async (modeDir, pieces) => {
  const errors = [];
  const warnings = [];
  for (const family of REQUIRED_VERIFY_FAMILIES) {
    if (!pieces.some((piece) => family.match(piece))) {
      errors.push(`${modeDir}: missing required artifact family ${family.label}`);
    }
  }
  for (const piece of pieces) {
    const relPath = typeof piece?.path === 'string' ? piece.path : '';
    if (!relPath) {
      errors.push(`${modeDir}: piece entry missing path (${piece?.name || 'unknown'})`);
      continue;
    }
    const absolutePath = path.resolve(modeDir, fromPosix(relPath));
    const modeRoot = path.resolve(modeDir);
    const relative = path.relative(modeRoot, absolutePath);
    if (isRelativePathEscape(relative) || path.isAbsolute(relative)) {
      errors.push(`${modeDir}: piece path escapes mode dir (${relPath})`);
      continue;
    }
    let stat = null;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      stat = null;
    }
    if (!stat) {
      errors.push(`${modeDir}: missing artifact ${relPath}`);
      continue;
    }
    const expectedBytes = Number(piece?.bytes);
    if (Number.isFinite(expectedBytes) && expectedBytes !== stat.size) {
      errors.push(`${modeDir}: bytes mismatch for ${relPath} (expected ${expectedBytes}, found ${stat.size})`);
      warnings.push(`${modeDir}: bytes mismatch for ${relPath}`);
    }
    const parsedChecksum = parseChecksum(piece?.checksum);
    if (parsedChecksum) {
      try {
        const computed = await checksumFile(absolutePath);
        if (computed?.algo !== parsedChecksum.algo || computed?.value !== parsedChecksum.value) {
          warnings.push(`${modeDir}: checksum mismatch for ${relPath}`);
        }
      } catch {
        warnings.push(`${modeDir}: failed to compute checksum for ${relPath}`);
      }
    }
  }
  return { errors, warnings };
};

const aggregateTotals = (modeReports) => {
  const totalChunkCount = modeReports.reduce((sum, mode) => sum + (mode.chunkMeta.rows || 0), 0);
  const totalFileCount = modeReports.reduce((sum, mode) => sum + (mode.fileMeta.rows || 0), 0);
  const bytesByFamily = {
    chunks: modeReports.reduce((sum, mode) => sum + mode.chunkMeta.bytes, 0),
    postings: modeReports.reduce((sum, mode) => (
      sum + mode.tokenPostings.bytes + mode.phraseNgrams.bytes + mode.chargramPostings.bytes
    ), 0),
    symbols: modeReports.reduce((sum, mode) => (
      sum + mode.symbols.bytes + mode.symbolOccurrences.bytes + mode.symbolEdges.bytes
    ), 0),
    relations: modeReports.reduce((sum, mode) => sum + mode.graphRelations.bytes + mode.callSites.bytes, 0),
    embeddings: modeReports.reduce((sum, mode) => (
      sum + mode.embeddings.denseVectors.bytes + mode.embeddings.hnsw.bytes + mode.embeddings.lancedb.bytes
    ), 0)
  };
  const totalBytes = Object.values(bytesByFamily).reduce((sum, value) => sum + value, 0);
  return {
    chunkCount: totalChunkCount,
    fileCount: totalFileCount,
    bytesByFamily,
    totalBytes
  };
};

const modeReports = [];
const verifyErrors = [];
const verifyWarnings = [];
let buildId = null;
let compatibilityKey = null;
let artifactSurfaceVersion = null;
let manifestRepoId = null;

const selected = selectModeDirs();
for (const { mode, dir } of selected.modes) {
  const manifest = loadPiecesManifest(dir, { strict: true });
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  if (!buildId && manifest?.buildId) buildId = manifest.buildId;
  if (!compatibilityKey && manifest?.compatibilityKey) compatibilityKey = manifest.compatibilityKey;
  if (!artifactSurfaceVersion && manifest?.artifactSurfaceVersion) artifactSurfaceVersion = manifest.artifactSurfaceVersion;
  if (!manifestRepoId && manifest?.repoId) manifestRepoId = manifest.repoId;

  const report = {
    mode,
    indexDir: dir,
    chunkMeta: buildChunkStats(pieces),
    tokenPostings: buildTokenStats(pieces),
    phraseNgrams: buildFamilyStats(pieces, { names: ['phrase_ngrams'], countFromName: 'phrase_ngrams' }),
    chargramPostings: buildFamilyStats(pieces, { names: ['chargram_postings'], countFromName: 'chargram_postings' }),
    symbols: buildFamilyStats(pieces, { names: ['symbols'], countFromName: 'symbols' }),
    symbolOccurrences: buildFamilyStats(pieces, { names: ['symbol_occurrences'], countFromName: 'symbol_occurrences' }),
    symbolEdges: buildFamilyStats(pieces, { names: ['symbol_edges'], countFromName: 'symbol_edges' }),
    graphRelations: buildFamilyStats(pieces, { names: ['graph_relations'], countFromName: 'graph_relations' }),
    callSites: buildFamilyStats(pieces, { names: ['call_sites'], countFromName: 'call_sites' }),
    fileMeta: buildFamilyStats(pieces, { names: ['file_meta'], countFromName: 'file_meta' }),
    embeddings: buildEmbeddingStats(pieces)
  };

  if (argv.verify === true) {
    const verify = await verifyManifestPieces(dir, pieces);
    verifyErrors.push(...verify.errors);
    verifyWarnings.push(...verify.warnings);
  }

  modeReports.push(report);
}

modeReports.sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode));
const totals = aggregateTotals(modeReports);
const modesPayload = {};
for (const report of modeReports) {
  modesPayload[report.mode] = {
    chunkMeta: report.chunkMeta,
    tokenPostings: report.tokenPostings,
    phraseNgrams: report.phraseNgrams,
    chargramPostings: report.chargramPostings,
    symbols: report.symbols,
    symbolOccurrences: report.symbolOccurrences,
    symbolEdges: report.symbolEdges,
    graphRelations: report.graphRelations,
    callSites: report.callSites,
    fileMeta: report.fileMeta,
    embeddings: report.embeddings
  };
}

const payload = {
  schemaVersion: SCHEMA_VERSION,
  repoId: selected.repoId || manifestRepoId || null,
  buildId: buildId || null,
  indexRoot: selected.indexRoot,
  artifactSurfaceVersion: artifactSurfaceVersion || null,
  compatibilityKey: compatibilityKey || null,
  modes: modesPayload,
  totals
};

if (argv.verify === true) {
  payload.verify = {
    ok: verifyErrors.length === 0,
    errors: verifyErrors,
    warnings: verifyWarnings
  };
}

if (argv.json) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  console.error(`index root: ${payload.indexRoot}`);
  console.error(`build: ${payload.buildId || 'unknown'} | compat: ${payload.compatibilityKey || 'unknown'}`);
  for (const mode of Object.keys(payload.modes)) {
    const modeStats = payload.modes[mode];
    console.error(
      `- ${mode}: chunks=${modeStats.chunkMeta.rows ?? 'n/a'} ` +
      `files=${modeReports.find((entry) => entry.mode === mode)?.fileMeta.rows ?? 'n/a'} bytes=${formatBytes(
        modeStats.chunkMeta.bytes + modeStats.tokenPostings.bytes
      )}`
    );
  }
  console.error(`total bytes: ${formatBytes(payload.totals.totalBytes)}`);
  if (payload.verify) {
    console.error(`verify: ${payload.verify.ok ? 'ok' : 'errors'}`);
    for (const warning of payload.verify.warnings) console.error(`warn: ${warning}`);
    for (const error of payload.verify.errors) console.error(`error: ${error}`);
  }
}

if (argv.verify === true && verifyErrors.length > 0) {
  process.exit(1);
}
