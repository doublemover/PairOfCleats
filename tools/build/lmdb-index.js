#!/usr/bin/env node
import { runNativeDatabaseCommand } from '../shared/native-database-lifetime.js';
import { LMDB_BUILD_OPTIONS } from '../shared/operator-cli-options.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MAX_JSON_BYTES } from '../../src/shared/artifact-io/constants.js';
import { readJsonFile } from '../../src/shared/artifact-io/json.js';
import { loadJsonObjectArtifact } from '../../src/shared/artifact-io/loaders.js';
import { loadPiecesManifest, resolveArtifactPresence } from '../../src/shared/artifact-io/manifest.js';
import {
  loadDenseVectorBinaryFromMetaAsync,
  resolveDenseVectorBinaryArtifact
} from '../../src/shared/dense-vector-artifacts.js';
import { writeJsonObjectFile } from '../../src/shared/json-stream/json-writers.js';
import { updateIndexStateManifest } from '../../src/shared/index-state-utils.js';
import { withGeneratedArtifactMetadata } from '../../src/shared/generated-artifact-core.js';
import { LMDB_ARTIFACT_KEYS, LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../../src/storage/lmdb/schema.js';
import { replaceLmdbEntries } from '../../src/storage/lmdb/replace.js';
import { loadLmdbArtifactInputs } from '../../src/storage/lmdb/artifact-inputs.js';
import { getIndexDir, getMetricsDir, resolveRepoCacheRootPath, resolveIndexRoot, resolveLmdbPaths, resolveRepoConfig } from '../shared/dict-utils.js';
import { resolveAsOfContext, resolveSingleRootForModes } from '../../src/index/as-of.js';
import { createIndexBuildToolCli } from './index-tool-cli.js';
import { Packr } from 'msgpackr';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

const require = createRequire(import.meta.url);
let open = null;
try {
  ({ open } = require('lmdb'));
} catch {}

await runNativeDatabaseCommand({ commandIdentity: 'lmdb.build', delegated: true }, async resources => {
  const { argv, display, log, warn } = createIndexBuildToolCli({
    scriptName: 'build-lmdb-index',
    options: LMDB_BUILD_OPTIONS
  });
  const fail = (message, exitCode = 1) => {
    display.error(message);
    throw Object.assign(new Error(message), { exitCode });
  };
  try {

    if (!open) {
      fail('lmdb is required. Run npm install first.');
    }

    const validateArtifacts = argv.validate === true;
    const buildModeRaw = String(argv.mode || 'all').trim().toLowerCase();
    const buildMode = buildModeRaw === 'both' ? 'all' : buildModeRaw;
    const supportedModes = ['code', 'prose'];
    const modes = buildMode === 'all' ? supportedModes : [buildMode];

    const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
    const asOfRequested = (
      (typeof argv['as-of'] === 'string' && argv['as-of'].trim())
  || (typeof argv.snapshot === 'string' && argv.snapshot.trim())
    );
    const asOfContext = asOfRequested
      ? resolveAsOfContext({
        repoRoot: root,
        userConfig,
        requestedModes: modes,
        asOf: argv['as-of'],
        snapshot: argv.snapshot,
        preferFrozen: true,
        allowMissingModesForLatest: false
      })
      : null;
    const asOfRootSelection = asOfContext?.provided
      ? resolveSingleRootForModes(asOfContext.indexBaseRootByMode, modes)
      : { roots: [], root: null, mixed: false };
    if (asOfContext?.strict && modes.length > 1 && asOfRootSelection.mixed) {
      fail(
        `[lmdb] --as-of ${asOfContext.ref} resolves to multiple index roots for selected modes. ` +
    'Select a single mode.'
      );
    }
    const indexRoot = argv['index-root']
      ? path.resolve(argv['index-root'])
      : (asOfRootSelection.root ? path.resolve(asOfRootSelection.root) : resolveIndexRoot(root, userConfig));
    const lmdbPaths = resolveLmdbPaths(root, userConfig, { indexRoot });
    resources.admitScope({ repoCacheRoot: resolveRepoCacheRootPath(root, userConfig),
      indexRoot: argv['index-root'] ? indexRoot : null, userConfig,
      targets: modes.map(mode => mode === 'code' ? lmdbPaths.codePath : lmdbPaths.prosePath) });
    const metricsDir = getMetricsDir(root, userConfig);

    /**
 * Read JSON artifact when present; return `null` for missing files.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
    const readJsonOptional = (filePath) => {
      if (!filePath || !fsSync.existsSync(filePath)) return null;
      return readJsonFile(filePath, { maxBytes: MAX_JSON_BYTES });
    };

    /**
 * Sum numeric doc-length entries, ignoring non-finite values.
 *
 * @param {unknown[]} docLengths
 * @returns {number|null}
 */
    const sumDocLengths = (docLengths) => {
      if (!Array.isArray(docLengths)) return null;
      let total = 0;
      for (const entry of docLengths) {
        const value = Number(entry);
        if (Number.isFinite(value)) total += value;
      }
      return total;
    };


    /**
 * Update `index_state.json` with LMDB metadata patch and refresh manifest.
 *
 * @param {string} indexDir
 * @param {object} patch
 * @returns {Promise<object|null>}
 */
    const updateLmdbState = async (indexDir, patch) => {
      if (!indexDir) return null;
      const statePath = path.join(indexDir, 'index_state.json');
      let state = {};
      if (fsSync.existsSync(statePath)) {
        try {
          state = readJsonFile(statePath, { maxBytes: MAX_JSON_BYTES }) || {};
        } catch {
          state = {};
        }
      }
      const now = new Date().toISOString();
      state.generatedAt = state.generatedAt || now;
      state.updatedAt = now;
      state.lmdb = {
        ...(state.lmdb || {}),
        ...patch,
        updatedAt: now
      };
      state = withGeneratedArtifactMetadata(state, 'index-state');
      try {
        await writeJsonObjectFile(statePath, { fields: state, atomic: true });
      } catch {
        // Ignore index state write failures.
      }
      await updateIndexStateManifest(indexDir);
      return state;
    };

    const modeTask = display.task('LMDB', { total: modes.length, stage: 'lmdb' });
    let completedModes = 0;

    const packr = new Packr();
    const LMDB_PAGE_SIZE = 4096;
    const LMDB_MAP_SIZE_FACTOR = 2;
    const LMDB_MIN_MAP_SIZE = 64 * 1024 * 1024;

    const alignMapSize = (bytes) => {
      const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
      return Math.ceil(size / LMDB_PAGE_SIZE) * LMDB_PAGE_SIZE;
    };

    const estimateValueBytes = (value) => {
      if (value == null) return 0;
      try {
        return packr.pack(value).length;
      } catch {
        return 0;
      }
    };

    const estimateEntryBytes = (key, value) => (
      Buffer.byteLength(String(key || '')) + estimateValueBytes(value)
    );

    const estimateLmdbBytes = (meta, artifacts) => {
      let total = 0;
      const metaEntries = [
        [LMDB_META_KEYS.schemaVersion, LMDB_SCHEMA_VERSION],
        [LMDB_META_KEYS.createdAt, meta.createdAt],
        [LMDB_META_KEYS.mode, meta.mode],
        [LMDB_META_KEYS.sourceIndex, meta.sourceIndex],
        [LMDB_META_KEYS.chunkCount, meta.chunkCount],
        [LMDB_META_KEYS.artifacts, meta.artifacts],
        [LMDB_META_KEYS.artifactManifest, { keys: meta.artifacts, createdAt: meta.createdAt }]
      ];
      for (const [key, value] of metaEntries) {
        total += estimateEntryBytes(key, value);
      }
      for (const [key, value] of Object.entries(artifacts || {})) {
        total += estimateEntryBytes(key, value);
      }
      return total;
    };

    /**
 * Resolve LMDB map size from estimated payload bytes with padding/alignment.
 *
 * @param {number} estimatedBytes
 * @returns {number}
 */
    const resolveMapSizeBytes = (estimatedBytes) => {
      const estimated = Number.isFinite(estimatedBytes) ? estimatedBytes : 0;
      const padded = estimated * LMDB_MAP_SIZE_FACTOR;
      const base = Math.max(LMDB_MIN_MAP_SIZE, Math.ceil(padded));
      return alignMapSize(base);
    };

    const storeValue = (db, key, value) => {
      if (value == null) return false;
      db.putSync(key, packr.pack(value));
      return true;
    };

    const storeArtifacts = (db, meta, artifacts) => {
      replaceLmdbEntries(db, [
        [LMDB_META_KEYS.schemaVersion, LMDB_SCHEMA_VERSION],
        [LMDB_META_KEYS.createdAt, meta.createdAt],
        [LMDB_META_KEYS.mode, meta.mode],
        [LMDB_META_KEYS.sourceIndex, meta.sourceIndex],
        [LMDB_META_KEYS.chunkCount, meta.chunkCount],
        [LMDB_META_KEYS.artifacts, meta.artifacts],
        [LMDB_META_KEYS.artifactManifest, {
          keys: meta.artifacts,
          createdAt: meta.createdAt
        }],
        [LMDB_META_KEYS.mapSizeBytes, meta.mapSizeBytes],
        [LMDB_META_KEYS.mapSizeEstimatedBytes, meta.mapSizeEstimatedBytes],
        [LMDB_META_KEYS.mapSizeFactor, meta.mapSizeFactor],
        [LMDB_META_KEYS.pageSize, meta.pageSize],
        ...Object.entries(artifacts)
      ], value => packr.pack(value));
    };

    const validateRequiredArtifacts = (indexDir, mode) => {
      const manifest = loadPiecesManifest(indexDir, { maxBytes: MAX_JSON_BYTES, strict: true });
      for (const name of ['chunk_meta', 'token_postings']) {
        const presence = resolveArtifactPresence(indexDir, name, { manifest, strict: true });
        if (presence.error || presence.format === 'missing' || presence.missingMeta || presence.missingPaths.length) {
          fail(`[lmdb] ${mode} missing or invalid ${name} artifacts. Run build_index.js first.`, 2);
        }
      }
    };

    const loadArtifactsForMode = async (indexDir, mode) => {
      const { manifest, chunkMeta, tokenPostings, fileMeta, fileRelations, repoMap, fieldPostings,
        fieldTokens, phraseNgrams, chargramPostings, minhashSignatures, indexState } = await loadLmdbArtifactInputs(indexDir, { mode });
      const loadDenseVectorArtifact = async (artifactName) => {
        const descriptor = resolveDenseVectorBinaryArtifact(artifactName);
        if (!descriptor) return null;
        const binaryDeclared = manifest.pieces.some(piece => piece.name === descriptor.metaName
          || (piece.name === descriptor.binName && piece.format === 'binary'));
        if (!binaryDeclared) {
          // Logical dense rows also have a sharded JSON representation. Its
          // declaration does not imply that optional binary sidecars exist.
          if (!manifest.pieces.some(piece => piece.name === artifactName || piece.name === `${artifactName}_meta`)) return null;
          return loadJsonObjectArtifact(indexDir, artifactName, { maxBytes: MAX_JSON_BYTES, manifest, strict: true });
        }
        const meta = await loadJsonObjectArtifact(indexDir, descriptor.metaName, {
          maxBytes: MAX_JSON_BYTES, manifest, strict: true
        });
        return await loadDenseVectorBinaryFromMetaAsync({
          dir: indexDir,
          baseName: descriptor.baseName,
          meta, manifest, strict: true
        });
      };
      const filterIndex = readJsonOptional(path.join(indexDir, 'filter_index.json'));
      const denseResults = await Promise.allSettled([
        loadDenseVectorArtifact('dense_vectors'),
        loadDenseVectorArtifact('dense_vectors_doc'),
        loadDenseVectorArtifact('dense_vectors_code')
      ]);
      let denseFailure, denseFailed = false;
      for (const outcome of denseResults) if (outcome.status === 'rejected') {
        denseFailure = denseFailed ? addStorageFailureContext(denseFailure, {}, outcome.reason, { secondaryPresent: true }) : outcome.reason;
        denseFailed = true;
      }
      if (denseFailed) throw denseFailure;
      const [denseVectors, denseVectorsDoc, denseVectorsCode] = denseResults.map(outcome => outcome.value);
      const loadHnswMeta = async name => {
        if (!manifest?.pieces?.some(piece => piece.name === name)) return null;
        return loadJsonObjectArtifact(indexDir, name, { manifest, maxBytes: MAX_JSON_BYTES, strict: true });
      };
      const [denseHnswMeta, denseHnswMetaDoc, denseHnswMetaCode] = await Promise.all([
        loadHnswMeta('dense_vectors_hnsw_meta'), loadHnswMeta('dense_vectors_doc_hnsw_meta'),
        loadHnswMeta('dense_vectors_code_hnsw_meta')
      ]);
      const artifacts = {
        [LMDB_ARTIFACT_KEYS.chunkMeta]: chunkMeta,
        [LMDB_ARTIFACT_KEYS.tokenPostings]: tokenPostings,
        [LMDB_ARTIFACT_KEYS.fileMeta]: fileMeta,
        [LMDB_ARTIFACT_KEYS.fileRelations]: fileRelations,
        [LMDB_ARTIFACT_KEYS.repoMap]: repoMap,
        [LMDB_ARTIFACT_KEYS.filterIndex]: filterIndex,
        [LMDB_ARTIFACT_KEYS.fieldPostings]: fieldPostings,
        [LMDB_ARTIFACT_KEYS.fieldTokens]: fieldTokens,
        [LMDB_ARTIFACT_KEYS.phraseNgrams]: phraseNgrams,
        [LMDB_ARTIFACT_KEYS.chargramPostings]: chargramPostings,
        [LMDB_ARTIFACT_KEYS.minhashSignatures]: minhashSignatures,
        [LMDB_ARTIFACT_KEYS.denseVectors]: denseVectors,
        [LMDB_ARTIFACT_KEYS.denseVectorsDoc]: denseVectorsDoc,
        [LMDB_ARTIFACT_KEYS.denseVectorsCode]: denseVectorsCode,
        [LMDB_ARTIFACT_KEYS.denseHnswMeta]: denseHnswMeta,
        [LMDB_ARTIFACT_KEYS.denseHnswMetaDoc]: denseHnswMetaDoc,
        [LMDB_ARTIFACT_KEYS.denseHnswMetaCode]: denseHnswMetaCode,
        [LMDB_ARTIFACT_KEYS.indexState]: indexState
      };
      const artifactKeys = Object.entries(artifacts)
        .filter(([, value]) => value != null)
        .map(([key]) => key);
      const meta = {
        createdAt: new Date().toISOString(),
        mode,
        sourceIndex: indexDir,
        chunkCount: Array.isArray(chunkMeta) ? chunkMeta.length : 0,
        artifacts: artifactKeys
      };
      const stats = {
        chunkCount: meta.chunkCount,
        fileCount: Array.isArray(fileMeta) ? fileMeta.length : null,
        tokenCount: sumDocLengths(tokenPostings?.docLengths)
      };
      return { meta, artifacts, stats };
    };

    for (const mode of modes) {
      if (!supportedModes.includes(mode)) {
        fail(`Invalid mode: ${mode}. LMDB supports code|prose|all.`);
      }
      modeTask.set(completedModes, modes.length, { message: `building ${mode}` });
      const indexDir = asOfContext?.provided
        ? asOfContext.indexDirByMode?.[mode] || null
        : getIndexDir(root, mode, userConfig, { indexRoot });
      if (asOfContext?.strict && !indexDir) {
        fail(`[lmdb] ${mode} index is unavailable for --as-of ${asOfContext.ref}.`, 2);
      }
      if (validateArtifacts) {
        validateRequiredArtifacts(indexDir, mode);
      }
      const targetPath = mode === 'code' ? lmdbPaths.codePath : lmdbPaths.prosePath;
      const buildStart = Date.now();
      const readStart = Date.now();
      const { meta, artifacts, stats } = await loadArtifactsForMode(indexDir, mode);
      const estimatedBytes = estimateLmdbBytes(meta, artifacts);
      const mapSizeBytes = resolveMapSizeBytes(estimatedBytes);
      meta.mapSizeEstimatedBytes = estimatedBytes;
      meta.mapSizeBytes = mapSizeBytes;
      meta.mapSizeFactor = LMDB_MAP_SIZE_FACTOR;
      meta.pageSize = LMDB_PAGE_SIZE;
      const readMs = Date.now() - readStart;
      // A rejected selected source must not invalidate an otherwise ready old
      // store or create its replacement target before source admission settles.
      await fs.mkdir(targetPath, { recursive: true });
      await updateLmdbState(indexDir, {
        enabled: true,
        ready: false,
        pending: true,
        schemaVersion: LMDB_SCHEMA_VERSION,
        buildMode
      });
      const writeStart = Date.now();
      const db = resources.open(() => open({ path: targetPath, readOnly: false, mapSize: mapSizeBytes }));
      await resources.use(db, () => storeArtifacts(db, meta, artifacts));
      const writeMs = Date.now() - writeStart;

      const finalState = await updateLmdbState(indexDir, {
        enabled: true,
        ready: true,
        pending: false,
        schemaVersion: LMDB_SCHEMA_VERSION,
        buildMode,
        path: targetPath,
        mapSizeBytes,
        mapSizeEstimatedBytes: estimatedBytes
      });
      const finalDb = resources.open(() => open({ path: targetPath, readOnly: false, mapSize: mapSizeBytes }));
      await resources.use(finalDb, () => storeValue(finalDb, LMDB_ARTIFACT_KEYS.indexState, finalState));

      const totalMs = Date.now() - buildStart;
      const metrics = {
        generatedAt: new Date().toISOString(),
        mode,
        indexDir,
        sourceIndex: meta.sourceIndex,
        artifacts: meta.artifacts,
        files: { candidates: stats.fileCount },
        chunks: { total: stats.chunkCount },
        tokens: { total: stats.tokenCount },
        lmdb: {
          path: targetPath,
          mapSizeBytes,
          mapSizeEstimatedBytes: estimatedBytes,
          mapSizeFactor: LMDB_MAP_SIZE_FACTOR
        },
        timings: {
          totalMs,
          readMs,
          writeMs
        }
      };
      try {
        await fs.mkdir(metricsDir, { recursive: true });
        await writeJsonObjectFile(
          path.join(metricsDir, `lmdb-${mode}.json`),
          { fields: metrics, atomic: true }
        );
      } catch {}

      completedModes += 1;
      modeTask.set(completedModes, modes.length, { message: `built ${mode}` });
      log(`[lmdb] ${mode} index built at ${targetPath}.`);
    }

  } finally { display.close(); }
}).catch(error => {
  process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  console.error(error);
});
