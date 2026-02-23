import fs from 'node:fs';
import path from 'node:path';
import {
  getBuildsRoot,
  getRepoRoot,
  loadUserConfig
} from '../shared/dict-utils.js';
import { normalizePostingsConfig } from '../shared/postings-config.js';
import {
  loadGraphRelations,
  loadJsonArrayArtifact,
  readJsonFile
} from '../shared/artifact-io.js';
import { isAbsolutePathNative } from '../shared/files.js';
import { ARTIFACT_SURFACE_VERSION, isSupportedVersion } from '../contracts/versioning.js';
import { isWithinRoot, toRealPathSync } from '../workspace/identity.js';
import { resolveIndexDir } from './validate/paths.js';
import { buildArtifactLists } from './validate/artifacts.js';
import { normalizeFilterIndex } from './validate/normalize.js';
import { addIssue } from './validate/issues.js';
import { validateSchema } from './validate/schema.js';
import { createArtifactPresenceHelpers } from './validate/presence.js';
import { loadAndValidateManifest, sumManifestCounts } from './validate/manifest.js';
import { buildLmdbReport } from './validate/lmdb-report.js';
import { buildSqliteReport } from './validate/sqlite-report.js';
import {
  loadAndValidateChunkMeta,
  validateFileMetaConsistency
} from './validate/chunk-meta.js';
import {
  validateCorePostingsArtifacts,
  validateSupplementalPostingsArtifacts
} from './validate/postings.js';
import { validateEmbeddingArtifacts } from './validate/embeddings.js';
import { validateOrderingLedger } from './validate/ordering-ledger.js';
import { loadOrderingLedger } from './build/build-state.js';
import { validateFileNameCollisions, validateIdPostings } from './validate/checks.js';

/**
 * Validate index artifacts for selected modes against manifest presence and
 * optional ordering ledger constraints.
 *
 * @param {object} [input]
 * @param {string} [input.root]
 * @param {string|null} [input.indexRoot]
 * @param {object} [input.userConfig]
 * @param {string[]} [input.modes]
 * @param {boolean} [input.sqliteEnabled]
 * @param {boolean} [input.strict]
 * @param {boolean} [input.validateOrdering]
 * @returns {Promise<object>}
 */
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
      const {
        chunkMeta,
        fileMeta,
        indexState,
        chunkUidSet
      } = await loadAndValidateChunkMeta({
        report,
        mode,
        dir,
        manifest,
        strict,
        modeReport,
        root,
        userConfig,
        indexRoot,
        sqliteEnabled,
        readJsonArtifact,
        shouldLoadOptional,
        checkPresence
      });
      if (!chunkMeta) {
        report.modes[mode] = modeReport;
        continue;
      }

      const { vocabHashes } = validateCorePostingsArtifacts({
        report,
        mode,
        dir,
        manifest,
        strict,
        modeReport,
        chunkMeta,
        postingsConfig,
        resolvePresence,
        hasLegacyArtifact,
        readJsonArtifact
      });

      validateFileMetaConsistency({
        report,
        mode,
        strict,
        fileMeta,
        chunkMeta
      });

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

      const determinismReport = readJsonArtifact('determinism_report');
      if (determinismReport) {
        validateSchema(
          report,
          mode,
          'determinism_report',
          determinismReport,
          'Rebuild index artifacts for this mode.',
          { strictSchema: strict }
        );
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

      validateOrderingLedger({
        orderingLedger,
        orderingStrict,
        report,
        modeReport,
        mode,
        indexState,
        chunkMeta,
        relations,
        repoMap,
        graphRelations,
        vocabHashes
      });

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

      await validateSupplementalPostingsArtifacts({
        report,
        mode,
        dir,
        manifest,
        strict,
        modeReport,
        chunkMeta,
        shouldLoadOptional,
        readJsonArtifact,
        validateManifestCount,
        vocabHashes
      });

      validateEmbeddingArtifacts({
        report,
        mode,
        dir,
        manifest,
        strict,
        modeReport,
        chunkMeta,
        validateManifestCount,
        lanceConfig,
        readJsonArtifact
      });
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
          const canonicalRepoCacheRoot = toRealPathSync(repoCacheRoot);
          const ensureSafeRoot = (value, label) => {
            if (!value) return;
            const resolved = isAbsolutePathNative(value) ? value : path.join(repoCacheRoot, value);
            const normalized = path.resolve(resolved);
            if (!isWithinRoot(normalized, repoCacheRoot)) {
              addIssue(report, null, `current.json ${label} escapes repo cache root`);
              return;
            }
            const canonicalResolved = toRealPathSync(normalized);
            if (!isWithinRoot(canonicalResolved, canonicalRepoCacheRoot)) {
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
