import fs from 'node:fs';
import path from 'node:path';
import {
  getBuildsRoot,
  getRepoRoot,
  loadUserConfig,
  resolveSqlitePaths
} from '../shared/dict-utils.js';
import { normalizePostingsConfig } from '../shared/postings-config.js';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadGraphRelations,
  loadJsonArrayArtifact,
  loadTokenPostings,
  readJsonFile,
  resolveBinaryArtifactPath,
  resolveDirArtifactPath
} from '../shared/artifact-io.js';
import { resolveLanceDbPaths } from '../shared/lancedb.js';
import { isAbsolutePathNative } from '../shared/files.js';
import { ARTIFACT_SURFACE_VERSION, isSupportedVersion } from '../contracts/versioning.js';
import { resolveIndexDir } from './validate/paths.js';
import { buildArtifactLists } from './validate/artifacts.js';
import {
  hashDeterministicLines,
  hashDeterministicValues
} from '../shared/invariants.js';
import {
  extractArray,
  normalizeDenseVectors,
  normalizeFieldPostings,
  normalizeFilterIndex,
  normalizeMinhash,
  normalizePhrasePostings,
  normalizeTokenPostings
} from './validate/normalize.js';
import { addIssue } from './validate/issues.js';
import { validateSchema } from './validate/schema.js';
import { createArtifactPresenceHelpers } from './validate/presence.js';
import { loadAndValidateManifest, sumManifestCounts } from './validate/manifest.js';
import { buildLmdbReport } from './validate/lmdb-report.js';
import { buildSqliteReport } from './validate/sqlite-report.js';
import { validateRiskInterproceduralArtifacts } from './validate/risk-interprocedural.js';
import { loadOrderingLedger } from './build/build-state.js';
import { createGraphRelationsIterator } from './build/artifacts/helpers.js';
import {
  validateChunkIds,
  validateChunkIdentity,
  validateFileNameCollisions,
  validateMetaV2Equivalence,
  validateMetaV2Types,
  validateSqliteMetaV2Parity,
  validateIdPostings,
  validatePostingsDocIds
} from './validate/checks.js';

const SQLITE_META_V2_PARITY_SAMPLE = 10;
const VALIDATION_ARTIFACT_MAX_CAP_BYTES = 1024 * 1024 * 1024; // 1 GiB safety cap
const VALIDATION_ARTIFACT_HEADROOM_BYTES = 8 * 1024 * 1024; // absorb small metadata drift

const resolveArtifactValidationMaxBytes = ({
  manifest,
  artifactNames,
  baseMaxBytes = MAX_JSON_BYTES
}) => {
  let resolved = Number.isFinite(Number(baseMaxBytes))
    ? Math.max(1, Math.floor(Number(baseMaxBytes)))
    : MAX_JSON_BYTES;
  const names = artifactNames instanceof Set
    ? artifactNames
    : new Set(Array.isArray(artifactNames) ? artifactNames : []);
  if (!names.size) return resolved;
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  for (const piece of pieces) {
    const name = typeof piece?.name === 'string' ? piece.name : '';
    if (!names.has(name)) continue;
    const bytes = Number(piece?.bytes);
    if (!Number.isFinite(bytes) || bytes <= 0) continue;
    const candidate = Math.min(
      VALIDATION_ARTIFACT_MAX_CAP_BYTES,
      Math.max(1, Math.floor(bytes + VALIDATION_ARTIFACT_HEADROOM_BYTES))
    );
    if (candidate > resolved) resolved = candidate;
  }
  return resolved;
};

const hashOrderingRows = (
  rows,
  { encodeLine = (row) => JSON.stringify(row) } = {}
) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // Validate against the exact ordering-line representation emitted by writers.
  const lines = rows.map((row) => encodeLine(row));
  return hashDeterministicLines(lines, { encodeLine: (line) => line });
};

const hashGraphRelationsRows = (relations) => {
  if (!relations || typeof relations !== 'object') return null;
  const iterator = createGraphRelationsIterator(relations)();
  const lines = [];
  for (const row of iterator) {
    lines.push(JSON.stringify(row));
  }
  return hashDeterministicLines(lines, { encodeLine: (line) => line });
};

const hashVocabList = (vocab) => {
  return hashDeterministicValues(vocab);
};

const resolveLedgerStageKey = (ledger, stage, mode) => {
  if (!ledger?.stages || typeof ledger.stages !== 'object') return null;
  const stageKey = stage ? String(stage) : null;
  const modeKey = stageKey && mode ? `${stageKey}:${mode}` : null;
  if (modeKey && ledger.stages[modeKey]) return modeKey;
  if (stageKey && ledger.stages[stageKey]) return stageKey;
  if (mode) {
    const match = Object.keys(ledger.stages).find((key) => key.endsWith(`:${mode}`));
    if (match) return match;
  }
  const keys = Object.keys(ledger.stages);
  return keys.length ? keys[0] : null;
};

const recordOrderingDrift = ({
  report,
  modeReport,
  mode,
  stageKey,
  artifact,
  expected,
  actual,
  strict,
  source = null
}) => {
  const expectedHash = expected?.hash || null;
  const actualHash = actual?.hash || null;
  const rule = expected?.rule || null;
  const issueLabel = `ordering ledger mismatch for ${artifact}`;
  const detail = `${issueLabel} (expected ${expectedHash ?? 'null'}, got ${actualHash ?? 'null'})`;
  const note = `[${mode}] ${detail}`;
  const drift = {
    stage: stageKey,
    mode,
    artifact,
    rule,
    expectedHash,
    actualHash,
    source
  };
  report.orderingDrift.push(drift);
  if (strict) {
    modeReport.ok = false;
    modeReport.missing.push(detail);
    report.issues.push(note);
  } else {
    modeReport.warnings.push(issueLabel);
    report.warnings.push(note);
  }
  report.hints.push('Rebuild ordering ledger by re-running index build.');
};
export async function validateIndexArtifacts(input = {}) {
  const root = getRepoRoot(input.root);
  const indexRoot = input.indexRoot ? path.resolve(input.indexRoot) : null;
  const userConfig = input.userConfig || loadUserConfig(root);
  const postingsConfig = normalizePostingsConfig(userConfig.indexing?.postings || {});
  const modes = Array.isArray(input.modes) && input.modes.length
    ? input.modes
    : ['code', 'prose', 'extracted-prose', 'records'];

  const sqliteEnabled = typeof input.sqliteEnabled === 'boolean'
    ? input.sqliteEnabled
    : userConfig.sqlite?.use !== false;
  const strict = input.strict !== false;

  const report = {
    ok: true,
    root: path.resolve(root),
    indexRoot: indexRoot ? path.resolve(indexRoot) : null,
    modes: {},
    sqlite: { enabled: sqliteEnabled },
    strict,
    issues: [],
    warnings: [],
    hints: [],
    orderingDrift: []
  };
  const orderingLedger = await loadOrderingLedger(indexRoot || root);
  const orderingStrict = input.validateOrdering === true;

  const {
    requiredArtifacts,
    strictOnlyRequiredArtifacts,
    optionalArtifacts,
    lanceConfig
  } = buildArtifactLists(userConfig, postingsConfig, {
    profileId: userConfig?.indexing?.profile
  });
  const symbolArtifacts = new Set(['symbols', 'symbol_occurrences', 'symbol_edges']);

  for (const mode of modes) {
    const dir = resolveIndexDir(root, mode, userConfig, indexRoot, strict);
    const modeReport = {
      path: path.resolve(dir),
      ok: true,
      missing: [],
      warnings: []
    };
    const { manifest } = await loadAndValidateManifest({
      report,
      mode,
      dir,
      strict,
      modeReport
    });

    const {
      resolvePresence,
      checkPresence,
      readJsonArtifact,
      shouldLoadOptional,
      hasLegacyArtifact
    } = createArtifactPresenceHelpers({
      dir,
      manifest,
      strict,
      mode,
      report,
      modeReport
    });
    const resolveManifestCount = (name) => {
      if (!strict || !manifest) return null;
      return sumManifestCounts(manifest, name);
    };
    const validateManifestCount = (name, actualCount, label = name) => {
      const expected = resolveManifestCount(name);
      if (!Number.isFinite(expected)) return;
      if (!Number.isFinite(actualCount)) return;
      if (expected !== actualCount) {
        const issue = `${label} manifest count mismatch (${expected} !== ${actualCount})`;
        modeReport.ok = false;
        modeReport.missing.push(issue);
        report.issues.push(`[${mode}] ${issue}`);
      }
    };

    const optionalArtifactsForMode = mode === 'code'
      ? optionalArtifacts
      : optionalArtifacts.filter((name) => !symbolArtifacts.has(name));
    if (strict) {
      for (const name of requiredArtifacts) {
        checkPresence(name, { required: true });
      }
      for (const name of strictOnlyRequiredArtifacts) {
        checkPresence(name, { required: true });
      }
      for (const name of optionalArtifactsForMode) {
        checkPresence(name, { required: false });
      }
    } else {
      for (const name of requiredArtifacts) {
        if (!hasLegacyArtifact(name)) {
          modeReport.ok = false;
          modeReport.missing.push(name);
          report.issues.push(`[${mode}] missing ${name}`);
          report.hints.push('Run `pairofcleats index build` to rebuild missing artifacts.');
        }
      }
      for (const name of optionalArtifactsForMode) {
        if (!hasLegacyArtifact(name)) {
          modeReport.warnings.push(name);
          report.warnings.push(`[${mode}] optional ${name} missing`);
        }
      }
    }
    try {
      let chunkMeta = null;
      const indexState = readJsonArtifact('index_state', { required: strict });
      const chunkMetaMaxBytes = resolveArtifactValidationMaxBytes({
        manifest,
        artifactNames: new Set([
          'chunk_meta',
          'chunk_meta_binary_columnar',
          'chunk_meta_cold'
        ])
      });
      try {
        chunkMeta = await loadChunkMeta(dir, {
          manifest,
          strict,
          maxBytes: chunkMetaMaxBytes
        });
      } catch (err) {
        addIssue(report, mode, `chunk_meta load failed (${err?.code || err?.message || err})`, 'Rebuild index artifacts for this mode.');
        modeReport.ok = false;
      }
      if (!chunkMeta) {
        report.modes[mode] = modeReport;
        continue;
      }
      validateSchema(report, mode, 'chunk_meta', chunkMeta, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      const fileMeta = readJsonArtifact('file_meta');
      if (Array.isArray(fileMeta) && fileMeta.length) {
        const fileMetaById = new Map();
        for (const entry of fileMeta) {
          if (!entry || entry.id == null) continue;
          fileMetaById.set(entry.id, entry);
        }
        if (fileMetaById.size) {
          for (const entry of chunkMeta) {
            if (!entry) continue;
            if (!entry.chunkId && entry.metaV2?.chunkId) entry.chunkId = entry.metaV2.chunkId;
            const meta = fileMetaById.get(entry.fileId);
            if (!meta) continue;
            if (!entry.file && meta.file) entry.file = meta.file;
            if (!entry.ext && meta.ext) entry.ext = meta.ext;
            if (!entry.fileHash && meta.hash) entry.fileHash = meta.hash;
            if (!entry.fileHashAlgo && meta.hashAlgo) entry.fileHashAlgo = meta.hashAlgo;
            if (!Number.isFinite(entry.fileSize) && Number.isFinite(meta.size)) entry.fileSize = meta.size;
          }
        }
      }
      validateChunkIds(report, mode, chunkMeta);
      const chunkUidSet = new Set();
      for (const entry of chunkMeta) {
        const uid = entry?.chunkUid || entry?.metaV2?.chunkUid || null;
        if (uid) chunkUidSet.add(uid);
      }
      await validateRiskInterproceduralArtifacts({
        report,
        mode,
        dir,
        manifest,
        strict,
        chunkUidSet,
        indexState,
        readJsonArtifact,
        shouldLoadOptional,
        checkPresence
      });
      if (strict) {
        validateChunkIdentity(report, mode, chunkMeta);
        validateMetaV2Types(report, mode, chunkMeta);
        validateMetaV2Equivalence(report, mode, chunkMeta, { maxSamples: 25, maxErrors: 10 });
        if (sqliteEnabled && (mode === 'code' || mode === 'prose')) {
          const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
          const dbPath = mode === 'code' ? sqlitePaths.codePath : sqlitePaths.prosePath;
          if (dbPath && fs.existsSync(dbPath)) {
            let Database = null;
            try {
              ({ default: Database } = await import('better-sqlite3'));
            } catch {
              addIssue(report, mode, 'sqlite parity check skipped: better-sqlite3 unavailable');
            }
            if (Database) {
              const db = new Database(dbPath, { readonly: true });
              try {
                const rows = db.prepare(
                  'SELECT id, chunk_id, metaV2_json FROM chunks WHERE mode = ? ORDER BY id LIMIT ?'
                ).all(mode, SQLITE_META_V2_PARITY_SAMPLE);
                validateSqliteMetaV2Parity(report, mode, chunkMeta, rows, { maxErrors: 10 });
              } finally {
                db.close();
              }
            }
          }
        }
      }

      if (postingsConfig.fielded && chunkMeta.length > 0) {
        const missingFieldArtifacts = [];
        const isMissingFieldArtifact = (name) => {
          if (strict) {
            const presence = resolvePresence(name);
            return !presence || presence.format === 'missing' || presence.error;
          }
          return !hasLegacyArtifact(name);
        };
        if (isMissingFieldArtifact('field_postings')) missingFieldArtifacts.push('field_postings');
        if (isMissingFieldArtifact('field_tokens')) missingFieldArtifacts.push('field_tokens');
        if (missingFieldArtifacts.length) {
          modeReport.ok = false;
          modeReport.missing.push(...missingFieldArtifacts);
          missingFieldArtifacts.forEach((artifact) => {
            report.issues.push(`[${mode}] missing ${artifact}`);
            report.hints.push('Run `pairofcleats index build` to rebuild missing artifacts.');
          });
        }
      }

      let tokenNormalized = null;
      let phraseNormalized = null;
      let chargramNormalized = null;
      try {
        const tokenIndex = loadTokenPostings(dir, { manifest, strict });
        tokenNormalized = normalizeTokenPostings(tokenIndex);
      } catch (err) {
        addIssue(report, mode, `token_postings load failed (${err?.code || err?.message || err})`, 'Rebuild index artifacts for this mode.');
        modeReport.ok = false;
      }
      if (tokenNormalized) {
        validateSchema(
          report,
          mode,
          'token_postings',
          tokenNormalized,
          'Rebuild index artifacts for this mode.',
          { strictSchema: strict }
        );
        const vocabIds = Array.isArray(tokenNormalized.vocabIds) ? tokenNormalized.vocabIds : [];
        if (vocabIds.length && vocabIds.length !== tokenNormalized.vocab.length) {
          const issue = `token_postings vocabIds mismatch (${vocabIds.length} !== ${tokenNormalized.vocab.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
        const docLengths = tokenNormalized.docLengths || [];
        if (docLengths.length && chunkMeta.length !== docLengths.length) {
          const issue = `docLengths mismatch (${docLengths.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
        validatePostingsDocIds(report, mode, 'token_postings', tokenNormalized.postings, chunkMeta.length);
      }

      const phraseRaw = readJsonArtifact('phrase_ngrams');
      if (phraseRaw) {
        phraseNormalized = normalizePhrasePostings(phraseRaw);
        validateSchema(report, mode, 'phrase_ngrams', phraseNormalized, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        validateIdPostings(report, mode, 'phrase_ngrams', phraseNormalized.postings, chunkMeta.length);
      }

      const chargramRaw = readJsonArtifact('chargram_postings');
      if (chargramRaw) {
        chargramNormalized = normalizePhrasePostings(chargramRaw);
        validateSchema(report, mode, 'chargram_postings', chargramNormalized, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        validateIdPostings(report, mode, 'chargram_postings', chargramNormalized.postings, chunkMeta.length);
      }

      if (fileMeta) {
        validateSchema(report, mode, 'file_meta', fileMeta, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        const fileIds = new Set();
        for (const entry of Array.isArray(fileMeta) ? fileMeta : []) {
          if (!Number.isFinite(entry?.id)) continue;
          if (fileIds.has(entry.id)) {
            addIssue(report, mode, `file_meta duplicate id ${entry.id}`, 'Rebuild index artifacts for this mode.');
            break;
          }
          fileIds.add(entry.id);
        }
        for (const chunk of chunkMeta) {
          const fileId = chunk?.fileId;
          if (fileId == null) continue;
          if (!fileIds.has(fileId)) {
            addIssue(report, mode, `chunk_meta fileId missing in file_meta (${fileId})`, 'Rebuild index artifacts for this mode.');
            break;
          }
        }
      }

      let repoMap = null;
      if (shouldLoadOptional('repo_map')) {
        try {
          repoMap = await loadJsonArrayArtifact(dir, 'repo_map', { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `repo_map load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (repoMap) {
        validateSchema(report, mode, 'repo_map', repoMap, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        validateFileNameCollisions(report, mode, repoMap);
      }

      let graphRelations = null;
      if (shouldLoadOptional('graph_relations')) {
        try {
          graphRelations = await loadGraphRelations(dir, { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `graph_relations load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (graphRelations) {
        validateSchema(report, mode, 'graph_relations', graphRelations, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      }

      const filterIndexRaw = readJsonArtifact('filter_index');
      const filterIndex = normalizeFilterIndex(filterIndexRaw);
      if (filterIndex) {
        validateSchema(report, mode, 'filter_index', filterIndex, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        const fileChunks = Array.isArray(filterIndex.fileChunksById) ? filterIndex.fileChunksById : [];
        validateIdPostings(report, mode, 'filter_index', fileChunks, chunkMeta.length);
      }

      if (indexState) {
        validateSchema(report, mode, 'index_state', indexState, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        if (strict && !isSupportedVersion(indexState?.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION)) {
          addIssue(
            report,
            mode,
            `index_state artifactSurfaceVersion unsupported: ${indexState?.artifactSurfaceVersion ?? 'missing'}`,
            'Rebuild index artifacts for this mode.'
          );
        }
        const tokenCollisionSummary = indexState?.extensions?.tokenIdCollisions;
        const tokenCollisionCount = Number.isFinite(Number(tokenCollisionSummary?.count))
          ? Number(tokenCollisionSummary.count)
          : 0;
        if (tokenCollisionCount > 0) {
          const sample = Array.isArray(tokenCollisionSummary?.sample) ? tokenCollisionSummary.sample : [];
          const first = sample.length
            ? sample[0]
            : null;
          const sampleText = first
            ? ` (${first.id}:${first.existing}->${first.token})`
            : '';
          addIssue(
            report,
            mode,
            `ERR_TOKEN_ID_COLLISION tokenId collisions recorded (${tokenCollisionCount})${sampleText}`,
            'Rebuild index with canonical token IDs.'
          );
        }
      }

      const fileLists = readJsonArtifact('filelists', { required: strict });
      if (fileLists) {
        validateSchema(report, mode, 'filelists', fileLists, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      }

      let relations = null;
      if (shouldLoadOptional('file_relations')) {
        try {
          relations = await loadJsonArrayArtifact(dir, 'file_relations', { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `file_relations load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (relations) {
        validateSchema(report, mode, 'file_relations', relations, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      }

      if (orderingLedger) {
        const stageKey = resolveLedgerStageKey(orderingLedger, indexState?.stage || 'stage2', mode);
        const ledgerStage = stageKey ? orderingLedger.stages?.[stageKey] : null;
        if (!ledgerStage || !ledgerStage.artifacts) {
          const warning = `[${mode}] ordering ledger missing stage ${stageKey || 'unknown'}`;
          if (orderingStrict) {
            modeReport.ok = false;
            modeReport.missing.push(warning);
            report.issues.push(warning);
          } else {
            modeReport.warnings.push('ordering ledger stage missing');
            report.warnings.push(warning);
          }
        } else {
          const actualHashes = {
            chunk_meta: hashOrderingRows(chunkMeta),
            file_relations: relations ? hashOrderingRows(relations) : null,
            repo_map: repoMap ? hashOrderingRows(repoMap) : null,
            graph_relations: graphRelations ? hashGraphRelationsRows(graphRelations) : null,
            token_vocab: tokenNormalized ? hashVocabList(tokenNormalized.vocab) : null,
            phrase_ngrams: phraseNormalized ? hashVocabList(phraseNormalized.vocab) : null,
            chargram_postings: chargramNormalized ? hashVocabList(chargramNormalized.vocab) : null
          };
          for (const [artifact, expected] of Object.entries(ledgerStage.artifacts)) {
            const actual = actualHashes[artifact] || null;
            if (!actual) {
              recordOrderingDrift({
                report,
                modeReport,
                mode,
                stageKey,
                artifact,
                expected,
                actual,
                strict: orderingStrict,
                source: 'missing-artifact'
              });
              continue;
            }
            if (expected?.hash && expected.hash !== actual.hash) {
              recordOrderingDrift({
                report,
                modeReport,
                mode,
                stageKey,
                artifact,
                expected,
                actual,
                strict: orderingStrict,
                source: 'hash-mismatch'
              });
            }
          }
        }
      }

      let callSites = null;
      if (shouldLoadOptional('call_sites')) {
        try {
          callSites = await loadJsonArrayArtifact(dir, 'call_sites', { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `call_sites load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (callSites) {
        validateSchema(report, mode, 'call_sites', callSites, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      }

      if (mode === 'code') {
        let symbols = null;
        if (shouldLoadOptional('symbols')) {
          try {
            symbols = await loadJsonArrayArtifact(dir, 'symbols', { manifest, strict });
          } catch (err) {
            addIssue(report, mode, `symbols load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
          }
        }
        if (symbols) {
          validateSchema(report, mode, 'symbols', symbols, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
          validateManifestCount('symbols', symbols.length, 'symbols');
          for (const entry of symbols) {
            if (!entry?.chunkUid) continue;
            if (!chunkUidSet.has(entry.chunkUid)) {
              addIssue(report, mode, `symbols chunkUid missing in chunk_meta (${entry.chunkUid})`, 'Rebuild index artifacts for this mode.');
              break;
            }
          }
        }

        let symbolOccurrences = null;
        if (shouldLoadOptional('symbol_occurrences')) {
          try {
            symbolOccurrences = await loadJsonArrayArtifact(dir, 'symbol_occurrences', { manifest, strict });
          } catch (err) {
            addIssue(report, mode, `symbol_occurrences load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
          }
        }
        if (symbolOccurrences) {
          validateSchema(report, mode, 'symbol_occurrences', symbolOccurrences, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
          validateManifestCount('symbol_occurrences', symbolOccurrences.length, 'symbol_occurrences');
          for (const entry of symbolOccurrences) {
            const hostUid = entry?.host?.chunkUid || null;
            if (!hostUid) continue;
            if (!chunkUidSet.has(hostUid)) {
              addIssue(report, mode, `symbol_occurrences host chunkUid missing in chunk_meta (${hostUid})`, 'Rebuild index artifacts for this mode.');
              break;
            }
          }
        }

        let symbolEdges = null;
        if (shouldLoadOptional('symbol_edges')) {
          try {
            symbolEdges = await loadJsonArrayArtifact(dir, 'symbol_edges', { manifest, strict });
          } catch (err) {
            addIssue(report, mode, `symbol_edges load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
          }
        }
        if (symbolEdges) {
          validateSchema(report, mode, 'symbol_edges', symbolEdges, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
          validateManifestCount('symbol_edges', symbolEdges.length, 'symbol_edges');
          const counts = { resolved: 0, ambiguous: 0, unresolved: 0 };
          for (const edge of symbolEdges) {
            const fromUid = edge?.from?.chunkUid || null;
            if (fromUid && !chunkUidSet.has(fromUid)) {
              addIssue(report, mode, `symbol_edges from chunkUid missing in chunk_meta (${fromUid})`, 'Rebuild index artifacts for this mode.');
              break;
            }
            const status = edge?.to?.status || null;
            if (status && Object.prototype.hasOwnProperty.call(counts, status)) {
              counts[status] += 1;
            }
            if (edge?.to?.status === 'resolved') {
              const resolvedUid = edge?.to?.resolved?.chunkUid || null;
              if (!resolvedUid || !chunkUidSet.has(resolvedUid)) {
                addIssue(report, mode, `symbol_edges resolved chunkUid missing in chunk_meta (${resolvedUid || 'missing'})`, 'Rebuild index artifacts for this mode.');
                break;
              }
            }
          }
          const total = counts.resolved + counts.ambiguous + counts.unresolved;
          if (total) {
            const resolvedRate = (counts.resolved / total).toFixed(3);
            const ambiguousRate = (counts.ambiguous / total).toFixed(3);
            const unresolvedRate = (counts.unresolved / total).toFixed(3);
            report.hints.push(`[${mode}] symbol_edges resolution: resolved=${resolvedRate}, ambiguous=${ambiguousRate}, unresolved=${unresolvedRate}`);
          }
        }
      }

      let vfsManifest = null;
      if (shouldLoadOptional('vfs_manifest')) {
        try {
          vfsManifest = await loadJsonArrayArtifact(dir, 'vfs_manifest', { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `vfs_manifest load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (vfsManifest) {
        validateSchema(report, mode, 'vfs_manifest', vfsManifest, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
      }

      const minhashRaw = readJsonArtifact('minhash_signatures');
      if (minhashRaw) {
        const minhash = normalizeMinhash(minhashRaw);
        validateSchema(report, mode, 'minhash_signatures', minhash, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        const signatures = minhash.signatures || [];
        if (signatures.length && signatures.length !== chunkMeta.length) {
          const issue = `minhash mismatch (${signatures.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
      }

      let fieldTokens = null;
      if (shouldLoadOptional('field_tokens')) {
        try {
          fieldTokens = await loadJsonArrayArtifact(dir, 'field_tokens', { manifest, strict });
        } catch (err) {
          addIssue(report, mode, `field_tokens load failed (${err?.message || err})`, 'Rebuild index artifacts for this mode.');
        }
      }
      if (fieldTokens) {
        validateSchema(report, mode, 'field_tokens', fieldTokens, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        if (Array.isArray(fieldTokens) && fieldTokens.length !== chunkMeta.length) {
          const issue = `field_tokens mismatch (${fieldTokens.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
      }

      const fieldPostingsRaw = readJsonArtifact('field_postings');
      const fieldPostings = normalizeFieldPostings(fieldPostingsRaw);
      if (fieldPostings) {
        validateSchema(report, mode, 'field_postings', fieldPostings, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
        const fields = fieldPostings.fields || {};
        for (const entry of Object.values(fields)) {
          validatePostingsDocIds(report, mode, 'field_postings', entry?.postings, chunkMeta.length);
          const lengths = Array.isArray(entry?.docLengths) ? entry.docLengths : [];
          if (lengths.length && lengths.length !== chunkMeta.length) {
            const issue = `field_postings docLengths mismatch (${lengths.length} !== ${chunkMeta.length})`;
            modeReport.ok = false;
            modeReport.missing.push(issue);
            report.issues.push(`[${mode}] ${issue}`);
          }
        }
      }

      const vocabOrder = readJsonArtifact('vocab_order');
      if (vocabOrder && typeof vocabOrder === 'object') {
        const tokenHash = tokenNormalized ? hashVocabList(tokenNormalized.vocab) : null;
        const phraseHash = phraseNormalized ? hashVocabList(phraseNormalized.vocab) : null;
        const chargramHash = chargramNormalized ? hashVocabList(chargramNormalized.vocab) : null;
        const vocab = vocabOrder?.fields?.vocab || vocabOrder?.vocab || null;
        const expectToken = vocab?.token?.hash || null;
        const expectPhrase = vocab?.phrase?.hash || null;
        const expectChargram = vocab?.chargram?.hash || null;
        if (expectToken && tokenHash?.hash && expectToken !== tokenHash.hash) {
          addIssue(report, mode, 'vocab_order token hash mismatch', 'Rebuild index artifacts for this mode.');
          modeReport.ok = false;
        }
        if (expectPhrase && phraseHash?.hash && expectPhrase !== phraseHash.hash) {
          addIssue(report, mode, 'vocab_order phrase hash mismatch', 'Rebuild index artifacts for this mode.');
          modeReport.ok = false;
        }
        if (expectChargram && chargramHash?.hash && expectChargram !== chargramHash.hash) {
          addIssue(report, mode, 'vocab_order chargram hash mismatch', 'Rebuild index artifacts for this mode.');
          modeReport.ok = false;
        }
      }

      const denseTargets = [
        { label: 'dense_vectors', name: 'dense_vectors', file: 'dense_vectors_uint8.json' },
        { label: 'dense_vectors_doc', name: 'dense_vectors_doc', file: 'dense_vectors_doc_uint8.json' },
        { label: 'dense_vectors_code', name: 'dense_vectors_code', file: 'dense_vectors_code_uint8.json' }
      ];
      for (const target of denseTargets) {
        const denseRaw = strict
          ? readJsonArtifact(target.name)
          : (() => {
            const densePath = path.join(dir, target.file);
            if (!fs.existsSync(densePath) && !fs.existsSync(`${densePath}.gz`)) return null;
            return readJsonFile(densePath);
          })();
        if (!denseRaw) continue;
        const dense = normalizeDenseVectors(denseRaw);
        validateSchema(report, mode, target.name, dense, 'Rebuild embeddings for this mode.', { strictSchema: strict });
        const vectors = dense.vectors || [];
        validateManifestCount(target.name, vectors.length, target.label);
        if (vectors.length && vectors.length !== chunkMeta.length) {
          const issue = `${target.label} mismatch (${vectors.length} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
        if (dense.dims) {
          for (let i = 0; i < Math.min(vectors.length, 25); i += 1) {
            if (!Array.isArray(vectors[i]) || vectors[i].length !== dense.dims) {
              addIssue(report, mode, `${target.label} dims mismatch at ${i}`, 'Rebuild embeddings for this mode.');
              break;
            }
          }
        }
      }
      const hnswTargets = [
        {
          label: 'dense_vectors_hnsw',
          metaName: 'dense_vectors_hnsw_meta',
          binName: 'dense_vectors_hnsw',
          metaPath: path.join(dir, 'dense_vectors_hnsw.meta.json'),
          binPath: path.join(dir, 'dense_vectors_hnsw.bin')
        },
        {
          label: 'dense_vectors_doc_hnsw',
          metaName: 'dense_vectors_doc_hnsw_meta',
          binName: 'dense_vectors_doc_hnsw',
          metaPath: path.join(dir, 'dense_vectors_doc_hnsw.meta.json'),
          binPath: path.join(dir, 'dense_vectors_doc_hnsw.bin')
        },
        {
          label: 'dense_vectors_code_hnsw',
          metaName: 'dense_vectors_code_hnsw_meta',
          binName: 'dense_vectors_code_hnsw',
          metaPath: path.join(dir, 'dense_vectors_code_hnsw.meta.json'),
          binPath: path.join(dir, 'dense_vectors_code_hnsw.bin')
        }
      ];
      for (const target of hnswTargets) {
        const hnswMeta = strict
          ? readJsonArtifact(target.metaName)
          : (fs.existsSync(target.metaPath) ? readJsonFile(target.metaPath) : null);
        if (!hnswMeta) continue;
        validateSchema(
          report,
          mode,
          target.metaName,
          hnswMeta,
          'Rebuild embeddings for this mode.',
          { strictSchema: strict }
        );
        const hnswCount = Number.isFinite(hnswMeta?.count) ? hnswMeta.count : chunkMeta.length;
        validateManifestCount(target.metaName, hnswCount, `${target.label} meta`);
        validateManifestCount(target.binName, hnswCount, `${target.label} bin`);
        if (Number.isFinite(hnswMeta?.count) && hnswMeta.count !== chunkMeta.length) {
          const issue = `${target.label} count mismatch (${hnswMeta.count} !== ${chunkMeta.length})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          report.issues.push(`[${mode}] ${issue}`);
        }
        const hnswIndexPath = resolveBinaryArtifactPath(dir, target.binName, {
          manifest,
          strict,
          fallbackPath: target.binPath
        });
        if (!hnswIndexPath || !fs.existsSync(hnswIndexPath)) {
          addIssue(report, mode, `${target.label} index missing`, 'Rebuild embeddings for this mode.');
        }
      }
      if (lanceConfig.enabled) {
        const lancePaths = resolveLanceDbPaths(dir);
        const lanceTargets = [
          {
            label: 'dense_vectors_lancedb',
            metaName: 'dense_vectors_lancedb_meta',
            dirName: 'dense_vectors_lancedb',
            metaPath: lancePaths.merged.metaPath,
            dir: lancePaths.merged.dir
          },
          {
            label: 'dense_vectors_doc_lancedb',
            metaName: 'dense_vectors_doc_lancedb_meta',
            dirName: 'dense_vectors_doc_lancedb',
            metaPath: lancePaths.doc.metaPath,
            dir: lancePaths.doc.dir
          },
          {
            label: 'dense_vectors_code_lancedb',
            metaName: 'dense_vectors_code_lancedb_meta',
            dirName: 'dense_vectors_code_lancedb',
            metaPath: lancePaths.code.metaPath,
            dir: lancePaths.code.dir
          }
        ];
        for (const target of lanceTargets) {
          const meta = strict
            ? readJsonArtifact(target.metaName)
            : (fs.existsSync(target.metaPath) ? readJsonFile(target.metaPath) : null);
          if (!meta) continue;
          validateSchema(
            report,
            mode,
            target.metaName,
            meta,
            'Rebuild embeddings for this mode.',
            { strictSchema: strict }
          );
          const lanceCount = Number.isFinite(meta?.count) ? meta.count : chunkMeta.length;
          validateManifestCount(target.metaName, lanceCount, `${target.label} meta`);
          validateManifestCount(target.dirName, lanceCount, `${target.label} dir`);
          if (Number.isFinite(meta?.count) && meta.count !== chunkMeta.length) {
            const issue = `${target.label} count mismatch (${meta.count} !== ${chunkMeta.length})`;
            modeReport.ok = false;
            modeReport.missing.push(issue);
            report.issues.push(`[${mode}] ${issue}`);
          }
          const lanceDir = resolveDirArtifactPath(dir, target.dirName, {
            manifest,
            strict,
            fallbackPath: target.dir
          });
          if (!lanceDir || !fs.existsSync(lanceDir)) {
            addIssue(report, mode, `${target.label} directory missing`, 'Rebuild embeddings for this mode.');
          }
        }
      }
      const sqliteVecMeta = strict
        ? readJsonArtifact('dense_vectors_sqlite_vec_meta')
        : (() => {
          const sqliteMetaPath = path.join(dir, 'dense_vectors_sqlite_vec.meta.json');
          return fs.existsSync(sqliteMetaPath) ? readJsonFile(sqliteMetaPath) : null;
        })();
      if (sqliteVecMeta) {
        validateSchema(
          report,
          mode,
          'dense_vectors_sqlite_vec_meta',
          sqliteVecMeta,
          'Rebuild embeddings for this mode.',
          { strictSchema: strict }
        );
        const sqliteCount = Number.isFinite(sqliteVecMeta?.count) ? sqliteVecMeta.count : chunkMeta.length;
        validateManifestCount('dense_vectors_sqlite_vec_meta', sqliteCount, 'dense_vectors_sqlite_vec_meta');
      }
    } catch (err) {
      const issue = `validation failed (${err?.code || err?.message || 'error'})`;
      modeReport.ok = false;
      modeReport.missing.push(issue);
      report.issues.push(`[${mode}] ${issue}`);
    }
    report.modes[mode] = modeReport;
  }

  if (!indexRoot) {
    const buildsRoot = getBuildsRoot(root, userConfig);
    const currentPath = path.join(buildsRoot, 'current.json');
    if (fs.existsSync(currentPath)) {
      try {
        const current = readJsonFile(currentPath);
        validateSchema(
          report,
          null,
          'builds_current',
          current,
          'Rebuild index artifacts for this repo.',
          { strictSchema: strict }
        );
        if (strict && !isSupportedVersion(current?.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION)) {
          addIssue(
            report,
            null,
            `current.json artifactSurfaceVersion unsupported: ${current?.artifactSurfaceVersion ?? 'missing'}`,
            'Rebuild index artifacts for this repo.'
          );
        }
        if (strict) {
          const repoCacheRoot = path.resolve(path.dirname(buildsRoot));
          const ensureSafeRoot = (value, label) => {
            if (!value) return;
            const resolved = isAbsolutePathNative(value) ? value : path.join(repoCacheRoot, value);
            const normalized = path.resolve(resolved);
            if (!normalized.startsWith(repoCacheRoot + path.sep) && normalized !== repoCacheRoot) {
              addIssue(report, null, `current.json ${label} escapes repo cache root`);
            }
          };
          ensureSafeRoot(current?.buildRoot, 'buildRoot');
          const rootsByMode = current?.buildRootsByMode || null;
          if (rootsByMode && typeof rootsByMode === 'object' && !Array.isArray(rootsByMode)) {
            for (const value of Object.values(rootsByMode)) {
              ensureSafeRoot(value, 'buildRootsByMode');
            }
          }
        }
      } catch (err) {
        addIssue(report, null, `current.json invalid (${err?.message || err})`);
      }
    }
  }

  const lmdbReport = await buildLmdbReport({
    root,
    userConfig,
    indexRoot,
    modes,
    report,
    lmdbEnabled: input.lmdbEnabled
  });

  const sqliteReport = await buildSqliteReport({
    root,
    userConfig,
    indexRoot,
    modes,
    report,
    sqliteEnabled: report.sqlite.enabled
  });

  report.lmdb = lmdbReport;
  report.sqlite = sqliteReport;
  report.ok = report.issues.length === 0;
  return report;
}

