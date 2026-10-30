#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { INDEX_STATS_OPTIONS, INDEX_STATS_MODES, assertIndexStatsFlags } from '../../src/shared/index-tool-options.js';
import { createCli } from '../../src/shared/cli.js';
import { checksumFile, sha1File, sha256File } from '../../src/shared/hash.js';
import { formatBytes } from '../../src/shared/disk-space.js';
import { loadPiecesManifest, resolveArtifactPresence } from '../../src/shared/artifact-io/manifest.js';
import { loadJsonObjectArtifact } from '../../src/shared/artifact-io/loaders.js';
import { resolveIndexArtifactPolicy } from '../../src/contracts/index-artifact-policy.js';
import { resolveRequiredArtifactsForProfile } from '../../src/contracts/index-profile.js';
import { accumulateManifestBytes, summarizeManifestBytes, buildPrefixedPieceStats, missingRequiredStatsFamilies } from './stats-artifacts.js';
import { logicalPayloadRows, sumKnownCounts } from './stats-artifacts.js';
import { fromPosix, isRelativePathEscape } from '../../src/shared/file-paths.js';
import { captureSelectedModeRoots } from '../../src/shared/indexing/selected-mode-roots.js';
import { getRepoId, loadUserConfig, resolveRepoRootArg } from '../shared/dict-utils.js';

const MODE_ORDER = INDEX_STATS_MODES;
const SCHEMA_VERSION = 1;

const argv = createCli({
  scriptName: 'index-stats',
  options: INDEX_STATS_OPTIONS
}).parse();

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
  const modeFilter = assertIndexStatsFlags(argv);
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
  const selection = captureSelectedModeRoots({ root: repoRoot, userConfig });
  const modes = selection.modes.filter(mode => !modeFilter || mode === modeFilter)
    .map(mode => ({ mode, dir: path.join(selection.roots[mode], `index-${mode}`) }));
  if (!modes.length) throw new Error('No selected index modes are published for this repository.');
  const roots = new Set(modes.map(entry => path.dirname(entry.dir)));
  return { source: selection.source, indexRoot: roots.size === 1 ? [...roots][0] : null,
    repoRoot, repoId: getRepoId(repoRoot), modes };

};

const buildFamilyStats = (pieces, {
  names,
  countFromName = null
}) => {
  const nameSet = new Set(names);
  const selected = pieces.filter((piece) => nameSet.has(String(piece?.name || '')));
  const bytes = selected.reduce((sum, piece) => sum + (Number(piece?.bytes) || 0), 0);
  return {
    rows: logicalPayloadRows(selected, countFromName || names[0]),
    bytes
  };
};

const buildChunkStats = (pieces) => buildPrefixedPieceStats(pieces, 'chunk_meta');

const buildTokenStats = (pieces) => buildPrefixedPieceStats(pieces, 'token_postings');

const buildEmbeddingStats = (pieces) => {
  const densePieces = pieces.filter((piece) => (
    String(piece?.name || '').startsWith('dense_vectors')
    && !String(piece?.name || '').includes('hnsw')
    && !String(piece?.name || '').includes('lancedb')
  ));
  const hnswPieces = pieces.filter((piece) => String(piece?.name || '').includes('hnsw'));
  const lancedbPieces = pieces.filter((piece) => String(piece?.name || '').includes('lancedb'));
  return {
    denseVectors: {
      // The primary vector payload owns this total. Binary metadata repeats it;
      // doc/code channels have independent absence/cardinality and are not rows
      // to add to, or a replacement maximum for, the primary payload.
      count: logicalPayloadRows(densePieces, 'dense_vectors'),
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

const verifyManifestPieces = async (modeDir, pieces, profileId, manifest) => {
  const errors = [];
  const warnings = [];
  for (const family of missingRequiredStatsFamilies(pieces, profileId)) errors.push(`${modeDir}: missing required artifact family ${family}`);
  for (const family of resolveRequiredArtifactsForProfile(profileId)) {
    if (!pieces.some(piece => piece.name === family)) continue;
    try {
      const presence = resolveArtifactPresence(modeDir, family, { manifest, strict: true });
      if (presence.error || presence.missingMeta || presence.missingPaths?.length) errors.push(`${modeDir}: incomplete required artifact family ${family}`);
    } catch (error) { errors.push(`${modeDir}: invalid required artifact family ${family}: ${error.message}`); }
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
    const expectedBytes = piece?.bytes == null ? null : Number(piece.bytes);
    if (Number.isFinite(expectedBytes) && expectedBytes !== stat.size) {
      errors.push(`${modeDir}: bytes mismatch for ${relPath} (expected ${expectedBytes}, found ${stat.size})`);
      warnings.push(`${modeDir}: bytes mismatch for ${relPath}`);
    }
    const parsedChecksum = parseChecksum(piece?.checksum);
    if (piece?.checksum != null && (!parsedChecksum
      || !['sha1', 'sha256', 'xxh64'].includes(parsedChecksum.algo)
      || !(parsedChecksum.algo === 'sha1' ? /^[a-f0-9]{40}$/i : parsedChecksum.algo === 'sha256' ? /^[a-f0-9]{64}$/i : /^[a-f0-9]{16}$/i).test(parsedChecksum.value))) {
      errors.push(`${modeDir}: malformed or unsupported checksum for ${relPath}`);
      continue;
    }
    if (parsedChecksum) {
      try {
        const computed = parsedChecksum.algo === 'sha1'
          ? { algo: 'sha1', value: await sha1File(absolutePath) }
          : parsedChecksum.algo === 'sha256' ? { algo: 'sha256', value: await sha256File(absolutePath) } : await checksumFile(absolutePath);
        if (computed?.algo !== parsedChecksum.algo || computed?.value !== parsedChecksum.value.toLowerCase()) {
          errors.push(`${modeDir}: checksum mismatch for ${relPath}`);
        }
      } catch {
        errors.push(`${modeDir}: failed to compute checksum for ${relPath}`);
      }
    }
  }
  return { errors, warnings };
};

const aggregateTotals = (modeReports) => {
  const chunkCounts = modeReports.map(mode => mode.chunkMeta.rows);
  const chunkSum = chunkCounts.reduce((sum, count) => sum + count, 0);
  const totalChunkCount = chunkCounts.every(count => Number.isSafeInteger(count) && count >= 0) && Number.isSafeInteger(chunkSum) ? chunkSum : null;
  const totalFileCount = sumKnownCounts(modeReports.map(mode => mode.fileMeta.rows));
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
  const selectedFamilyBytes = Object.values(bytesByFamily).reduce((sum, value) => sum + value, 0);
  const manifestBytes = summarizeManifestBytes(allPhysicalPieces);
  return {
    chunkCount: totalChunkCount,
    fileCount: totalFileCount,
    bytesByFamily,
    selectedFamilyBytes,
    totalBytes: manifestBytes.bytes,
    manifestPieces: manifestBytes.pieces,
    unknownPieceBytes: manifestBytes.unknownPieces
  };
};

const modeReports = [];
const allPhysicalPieces = new Map();
const verifyErrors = [];
const verifyWarnings = [];

const selected = selectModeDirs();
for (const { mode, dir } of selected.modes) {
  const manifest = loadPiecesManifest(dir, { strict: true });
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  accumulateManifestBytes(allPhysicalPieces, dir, pieces);

  const report = {
    mode,
    indexDir: dir,
    provenance: { buildId: manifest.buildId || null, compatibilityKey: manifest.compatibilityKey || null,
      artifactSurfaceVersion: manifest.artifactSurfaceVersion, repoId: manifest.repoId || null },
    manifestBytes: summarizeManifestBytes(accumulateManifestBytes(new Map(), dir, pieces)),
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
    const state = pieces.some(piece => piece.name === 'index_state')
      ? await loadJsonObjectArtifact(dir, 'index_state', { manifest, strict: true, maxBytes: 8 * 1024 * 1024 }) : null;
    const { profileId } = resolveIndexArtifactPolicy({ state, manifest,
      resolvePresence: name => resolveArtifactPresence(dir, name, { manifest, strict: true }) });
    const verify = await verifyManifestPieces(dir, pieces, profileId, manifest);
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
    indexDir: report.indexDir,
    provenance: report.provenance,
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

const sharedIdentity = key => {
  const values = new Set(modeReports.map(report => report.provenance[key]));
  return values.size === 1 ? [...values][0] : null;
};

const payload = {
  schemaVersion: SCHEMA_VERSION,
  repoId: selected.repoId || sharedIdentity('repoId'),
  buildId: sharedIdentity('buildId'),
  indexRoot: selected.indexRoot,
  artifactSurfaceVersion: sharedIdentity('artifactSurfaceVersion'),
  compatibilityKey: sharedIdentity('compatibilityKey'),
  generationSelection: selected.source,
  mixedGenerations: new Set(modeReports.map(report => report.provenance.buildId)).size > 1,
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
  console.error(`total bytes: ${payload.totals.totalBytes == null ? 'unknown (manifest byte counts missing)' : formatBytes(payload.totals.totalBytes)}`);
  if (payload.verify) {
    console.error(`verify: ${payload.verify.ok ? 'ok' : 'errors'}`);
    for (const warning of payload.verify.warnings) console.error(`warn: ${warning}`);
    for (const error of payload.verify.errors) console.error(`error: ${error}`);
  }
}

if (argv.verify === true && verifyErrors.length > 0) {
  process.exit(1);
}
