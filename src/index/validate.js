import { withVerifiedArtifactReadScope } from '../shared/artifact-io/verified-read-scope.js';
import { describeStorageFailure } from '../shared/storage/failure-observation.js';
import { createValidationReadPlan } from './validate/read-plan.js';
import { captureValidationSelection, readValidationSelection } from './validate/selection.js';
import { throwIfAborted } from '../shared/abort.js';
import path from 'node:path';
import {
  getRepoRoot,
  loadUserConfig
} from '../shared/dict-utils.js';
import { normalizePostingsConfig } from '../shared/postings-config.js';
import { loadJsonArrayArtifact } from '../shared/artifact-io/loaders/core.js';
import { loadGraphRelations } from '../shared/artifact-io/loaders/graph.js';
import { isAbsolutePathNative } from '../shared/file-paths.js';
import { ARTIFACT_SURFACE_VERSION, isSupportedVersion } from '../contracts/versioning.js';
import { isWithinRoot, toRealPathSync } from '../workspace/identity.js';
import { buildArtifactLists } from './validate/artifacts.js';
import { resolveIndexArtifactPolicy } from '../contracts/index-artifact-policy.js';
import { assertKnownIndexProfileId } from '../contracts/index-profile.js';
import { normalizeFilterIndex } from './validate/normalize.js';
import { addIssue, finalizeValidationReport, validationErrorMetadata } from './validate/issues.js';
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
  const signal = input.abortSignal ?? input.signal;
  throwIfAborted(signal);
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
  let selection = input.selection;
  if (!selection) {
    try { selection = captureValidationSelection({ root, userConfig, indexRoot, modes, strict }); }
    catch (error) {
      const metadata = validationErrorMetadata(error, 'generation-selection', 'ERR_INDEX_SELECTION_UNAVAILABLE');
      const diagnostic = describeStorageFailure(error, { phase: 'index-validation-selection' });
      for (const mode of modes) {
        report.modes[mode] = { path: null, ok: false, missing: [], warnings: [] };
        addIssue(report, mode, `generation selection failed (${diagnostic.message || metadata.code})`, null, 'issues', metadata);
      }
      for (const [capability, enabled] of [['sqlite', sqliteEnabled], ['lmdb', input.lmdbEnabled ?? userConfig.lmdb?.use !== false]]) {
        report[capability] = { enabled, ok: !enabled, code: null, prose: null, issues: [] };
        if (enabled) addIssue(report, null, 'backend selection unavailable', null, 'issues', {
          capability, artifact: 'generation-selection', state: 'unverified', code: 'ERR_INDEX_BACKEND_SELECTION_UNAVAILABLE'
        });
      }
      report.selection = null;
      return finalizeValidationReport(report);
    }
  }
  const { pointer: capturedPointer } = readValidationSelection(selection, { root, userConfig, indexRoot, modes, strict });
  if (selection.backendRequirements && typeof input.sqliteEnabled !== 'boolean') {
    report.sqlite.enabled = Object.values(selection.backendRequirements.sqlite).some(Boolean);
  }
  report.selection = selection;
  const orderingLedgers = new Map();
  const orderingFor = selectedRoot => {
    if (!orderingLedgers.has(selectedRoot)) orderingLedgers.set(selectedRoot, loadOrderingLedger(selectedRoot));
    return orderingLedgers.get(selectedRoot);
  };
  const orderingStrict = input.validateOrdering === true;

  const symbolArtifacts = new Set(['symbols', 'symbol_occurrences', 'symbol_edges']);

  for (const mode of modes) {
    throwIfAborted(signal);
    const dir = selection.indexDirs[mode];
    if (!dir) {
      report.modes[mode] = { path: null, ok: false, missing: ['mode is not declared by selected publication'], warnings: [] };
      addIssue(report, mode, 'mode is not declared by selected publication', null, 'issues', {
        state: 'missing', artifact: 'mode-root', code: 'ERR_INDEX_MODE_ROOT_UNAVAILABLE'
      });
      continue;
    }
    const modeIndexRoot = selection.roots[mode];
    const orderingLedger = await orderingFor(modeIndexRoot);
    throwIfAborted(signal);
    const modeReport = {
      path: path.resolve(dir),
      ok: true,
      missing: [],
      warnings: []
    };
    const readPlan = strict ? createValidationReadPlan({ root: dir, signal,
      metrics: input.readMetrics ? (input.readMetrics[mode] ||= {}) : {} }) : null;
    await withVerifiedArtifactReadScope(readPlan, async () => {
      const { manifest, finalizeManifest } = await loadAndValidateManifest({
        report,
        mode,
        dir,
        strict,
        modeReport,
        readPlan,
        signal
      });
      try {

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
        let policy;
        try {
          policy = resolveIndexArtifactPolicy({ state: readJsonArtifact('index_state', { required: strict }), manifest,
            resolvePresence, producerPolicy: input.producerPoliciesByMode?.[mode] });
        } catch (error) {
          modeReport.ok = false;
          addIssue(report, mode, error.message, 'Rebuild index artifacts for this mode.', 'issues',
            validationErrorMetadata(error, 'index_state', 'ERR_INDEX_ARTIFACT_POLICY'));
          report.modes[mode] = modeReport;
          return;
        }
        const modePostingsConfig = { ...postingsConfig, ...policy.postings };
        const { sparseEnabled, requiredArtifacts, strictOnlyRequiredArtifacts, optionalArtifacts, lanceConfig }
          = buildArtifactLists({ ...userConfig, indexing: { ...userConfig.indexing, profile: policy.profileId,
            artifacts: { ...userConfig.indexing?.artifacts, determinismReport: policy.determinismReport },
            embeddings: { ...userConfig.indexing?.embeddings,
              lancedb: { ...userConfig.indexing?.embeddings?.lancedb, enabled: policy.lancedbEnabled } } } },
          modePostingsConfig, { profileId: policy.profileId });
        const requestedProfile = assertKnownIndexProfileId(userConfig.indexing?.profile);
        const differences = [];
        if (requestedProfile !== policy.profileId) differences.push('profile');
        for (const key of ['fielded', 'enablePhraseNgrams', 'enableChargrams']) {
          if (policy.sparseEnabled && Boolean(postingsConfig[key]) !== Boolean(policy.postings[key])) differences.push(key);
        }
        if (Boolean(userConfig.indexing?.artifacts?.determinismReport) !== policy.determinismReport) differences.push('determinismReport');
        modeReport.compatibility = { ok: differences.length === 0, rebuildNeeded: differences.length > 0,
          reason: differences.length ? `requested configuration differs: ${differences.join(', ')}` : null };
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
            addIssue(report, mode, issue);
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
              addIssue(report, mode, `missing ${name}`, null, 'issues', { state: 'missing', artifact: name, modeMessage: name, code: 'ERR_INDEX_ARTIFACT_MISSING' });
              report.hints.push('Run `pairofcleats index build` to rebuild missing artifacts.');
            }
          }
          for (const name of optionalArtifactsForMode) {
            if (!hasLegacyArtifact(name)) {
              modeReport.warnings.push(name);
              addIssue(report, mode, `optional ${name} missing`, null, 'warnings', { state: 'missing', artifact: name, modeMessage: name, code: 'WARN_INDEX_OPTIONAL_MISSING' });
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
            indexRoot: modeIndexRoot,
            sqlitePath: selection.sqlitePaths[mode],
            sqliteEnabled,
            readJsonArtifact,
            shouldLoadOptional,
            checkPresence
          });
          if (!chunkMeta) {
            report.modes[mode] = modeReport;
            return;
          }

          const { vocabHashes } = validateCorePostingsArtifacts({
            report,
            mode,
            dir,
            manifest,
            strict,
            modeReport,
            chunkMeta,
            postingsConfig: modePostingsConfig,
            sparseEnabled,
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
            readJsonArtifact,
            resolvePresence
          });
        } catch (err) {
          const diagnostic = describeStorageFailure(err, { phase: 'index-validation', defaultCode: 'ERR_INDEX_VALIDATION_EXCEPTION' });
          const issue = `validation failed (${diagnostic.code || diagnostic.message || 'error'})`;
          modeReport.ok = false;
          modeReport.missing.push(issue);
          addIssue(report, mode, issue, null, 'issues', validationErrorMetadata(err, null, 'ERR_INDEX_VALIDATION_EXCEPTION'));
        }
        report.modes[mode] = modeReport;
      } finally {
        await finalizeManifest();
        throwIfAborted(signal);
      }
    });
  }

  if (!indexRoot && capturedPointer) {
    const buildsRoot = path.dirname(selection.pointerReceipt.path);
    try {
      const current = capturedPointer;
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

  throwIfAborted(signal);
  const lmdbReport = await buildLmdbReport({
    root,
    userConfig,
    indexRoot,
    modes,
    selection,
    report,
    lmdbEnabled: typeof input.lmdbEnabled === 'boolean' ? input.lmdbEnabled
      : selection.backendRequirements ? Object.values(selection.backendRequirements.lmdb).some(Boolean) : undefined
  });
  throwIfAborted(signal);

  const sqliteReport = await buildSqliteReport({
    root,
    userConfig,
    indexRoot,
    modes,
    selection,
    report,
    sqliteEnabled: report.sqlite.enabled
  });
  throwIfAborted(signal);

  report.lmdb = lmdbReport;
  report.sqlite = sqliteReport;
  return finalizeValidationReport(report);
}
