import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tryImport } from '../../../src/shared/optional-deps.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { assertLanceDbPayload, normalizeLanceDbConfig, resolveLanceDbPaths } from '../../../src/shared/lancedb.js';
import { publishLanceDbReplacement, recoverLanceDbReplacement } from './backend-publication.js';
import { readContainedFile } from '../../../src/shared/contained-file.js';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { getLanceDbEnv } from '../../../src/shared/env/runtime.js';
import { runIsolatedNodeScriptSync } from '../../../src/shared/subprocess/runner.js';
import { resolveVectorsSource } from './vector-source.js';

let warnedMissing = false;
const CHILD_ENV = 'PAIROFCLEATS_LANCEDB_CHILD';
const PAYLOAD_ENV = 'PAIROFCLEATS_LANCEDB_PAYLOAD';
const TRACE_ARTIFACT_IO = getEnvConfig().traceArtifactIo === true;

const loadLanceDb = async (logger) => {
  const result = await tryImport('@lancedb/lancedb');
  if (!result.ok) {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn('[embeddings] LanceDB unavailable; skipping LanceDB build.');
    }
    return null;
  }
  return result.mod?.default || result.mod;
};

const shouldIsolateLanceDb = (config, env) => {
  if (env?.child) return false;
  if (config?.isolate === false) return false;
  if (config?.isolate === true) return true;
  if (env?.isolate) return true;
  return false;
};

/**
 * Write a LanceDB index for a vector variant.
 * @param {object} params
 * @param {string} params.indexDir
 * @param {'merged'|'doc'|'code'} params.variant
 * @param {Array<ArrayLike<number>>} [params.vectors]
 * @param {string} [params.vectorsPath]
 * @param {number} params.dims
 * @param {string} params.modelId
 * @param {object} params.quantization
 * @param {number} params.scale
 * @param {boolean} params.normalize
 * @param {object} params.config
 * @param {boolean} [params.skipIsolate]
 * @param {boolean} [params.emitOutput]
 * @param {string|null} [params.label]
 * @param {object} [params.logger]
 * @returns {Promise<{skipped:boolean,reason?:string,count?:number}>}
 */
export async function writeLanceDbIndex({
  indexDir,
  variant,
  vectors,
  vectorsPath = null,
  dims,
  modelId,
  quantization,
  scale,
  normalize,
  config,
  skipIsolate = false,
  emitOutput = true,
  label = null,
  logger = console
}) {
  const resolvedConfig = normalizeLanceDbConfig(config);
  if (!resolvedConfig.enabled) return { skipped: true, reason: 'disabled' };
  const lanceEnv = getLanceDbEnv();
  const vectorsSource = Array.isArray(vectors) && vectors.length
    ? { count: vectors.length, vectors, rows: null }
    : resolveVectorsSource(vectorsPath, { stopOnShardMetaWithoutManifest: true, expectedDims: dims, expectedModelId: modelId });
  if (TRACE_ARTIFACT_IO && vectorsPath) {
    const exists = fsSync.existsSync(vectorsPath)
      || fsSync.existsSync(`${vectorsPath}.gz`)
      || fsSync.existsSync(`${vectorsPath}.zst`)
      || fsSync.existsSync(`${vectorsPath}.bak`)
      || fsSync.existsSync(`${vectorsPath}.meta.json`)
      || fsSync.existsSync(`${vectorsPath}.meta.json.bak`)
      || fsSync.existsSync(`${vectorsPath}.parts`);
    logger.log(`[embeddings] ${label || variant}: vectors source path=${vectorsPath} exists=${exists}`);
  }
  if (!vectorsSource || !Number.isFinite(vectorsSource.count) || vectorsSource.count <= 0) {
    return { skipped: true, reason: 'empty' };
  }
  if (!skipIsolate && shouldIsolateLanceDb(resolvedConfig, lanceEnv)) {
    if (!vectorsPath) {
      return { skipped: true, reason: 'missing vectors path for isolate' };
    }
    const moduleUrl = new URL('./lancedb.js', import.meta.url).href;
    const payload = {
      indexDir,
      variant,
      vectorsPath,
      dims,
      modelId,
      quantization,
      scale,
      normalize,
      config: resolvedConfig,
      emitOutput: false,
      label
    };
    const script = `
      const payload = JSON.parse(process.env.${PAYLOAD_ENV} || '{}');
      const moduleUrl = payload.moduleUrl;
      const run = async () => {
        const mod = await import(moduleUrl);
        const result = await mod.writeLanceDbIndex(payload);
        process.stdout.write(JSON.stringify(result || {}));
      };
      run().catch((err) => {
        console.error(err && err.message ? err.message : String(err));
        process.exit(2);
      });
    `;
    payload.moduleUrl = moduleUrl;
    const result = runIsolatedNodeScriptSync({
      script,
      env: {
        ...process.env,
        [CHILD_ENV]: '1',
        [PAYLOAD_ENV]: JSON.stringify(payload)
      },
      maxOutputBytes: 1024 * 1024,
      outputMode: 'string',
      captureStdout: true,
      captureStderr: true,
      rejectOnNonZeroExit: false,
      name: 'lancedb'
    });
    if (result.exitCode !== 0) {
      const detail = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      if (emitOutput && detail) {
        logger.warn(`[embeddings] ${label || variant}: LanceDB isolate failed: ${detail}`);
      }
      return { skipped: true, reason: 'isolate failed' };
    }
    let parsed = {};
    try {
      parsed = typeof result.stdout === 'string' ? JSON.parse(result.stdout) : {};
    } catch {}
    if (emitOutput && parsed && parsed.count) {
      const targetLabel = label || variant;
      logger.log(`[embeddings] ${targetLabel}: wrote LanceDB table (${parsed.count} vectors).`);
    }
    return parsed || { skipped: false };
  }

  const lancedb = await loadLanceDb(logger);
  if (!lancedb) return { skipped: true, reason: 'missing dependency' };

  const paths = resolveLanceDbPaths(indexDir);
  const target = paths[variant];
  if (!target) return { skipped: true, reason: 'unknown variant' };
  const dir = target.dir;
  const metaPath = target.metaPath;

  const connect = lancedb.connect || lancedb.default?.connect;
  if (typeof connect !== 'function') {
    return { skipped: true, reason: 'invalid module' };
  }

  await fs.mkdir(indexDir, { recursive: true });
  await recoverLanceDbReplacement({ dir, metaPath });
  const publicationId = randomUUID();
  const stageRoot = path.join(indexDir, `.lancedb-staging-${publicationId}`);
  await fs.mkdir(stageRoot);
  const stagedDir = path.join(stageRoot, path.basename(dir));
  const stagedMetaPath = path.join(stageRoot, path.basename(metaPath));
  let primaryError = null;
  try {
    const db = await connect(stagedDir);
    const tableName = resolvedConfig.table;
    const idColumn = resolvedConfig.idColumn;
    const embeddingColumn = resolvedConfig.embeddingColumn;
    const batchSize = Math.max(1, Math.floor(resolvedConfig.batchSize || 1024));

    let table = null;
    let writtenCount = 0;
    let actualCount = 0;
    let buildError = null;
    try {
      const { createLanceVectorContract } = await import('./lancedb-arrow.js');
      const contract = createLanceVectorContract({ dims, idColumn, embeddingColumn,
        batchSize, quantization, normalize });
      const flush = async () => {
        const data = contract.take();
        if (!data) return;
        try {
          if (!table) table = await db.createTable(tableName, data, { mode: 'overwrite', schema: contract.schema });
          else await table.add(data);
          if (!table) throw new Error('LanceDB could not create a nonempty table.');
          writtenCount += data.numRows;
        } finally { contract.release(); }
      };
      const append = async (docId, vector) => {
        // Absent channels retain their document-ID hole. Present malformed
        // vectors fail the staged build instead of silently changing schema.
        if (vector == null || vector.length === 0) return;
        contract.append(docId, vector);
        if (contract.size === contract.capacity) await flush();
      };
      if (vectorsSource.rows && typeof vectorsSource.rows[Symbol.asyncIterator] === 'function') {
        let docId = 0;
        for await (const entry of vectorsSource.rows) {
          const vector = entry && typeof entry === 'object' && !Array.isArray(entry) && !ArrayBuffer.isView(entry)
            ? (entry.vector ?? entry.values ?? null) : entry;
          await append(docId++, vector);
        }
      } else {
        for (let docId = 0; docId < vectorsSource.vectors.length; docId++) await append(docId, vectorsSource.vectors[docId]);
      }
      await flush();
      if (table) contract.assertSchema(await table.schema());
      if (!writtenCount) return { skipped: true, reason: 'empty', count: 0, rowCount: vectorsSource.count };
      actualCount = table ? await table.countRows() : 0;
      if (actualCount !== writtenCount) throw new Error(`LanceDB insert count mismatch (${actualCount} of ${writtenCount}).`);
    } catch (error) {
      buildError = error;
      throw error;
    } finally {
      const closeErrors = [];
      for (const resource of [table, db]) {
        try { await resource?.close?.(); } catch (error) { closeErrors.push(error); }
      }
      if (closeErrors.length) throw new AggregateError(buildError ? [buildError, ...closeErrors] : closeErrors,
        'LanceDB writer failed to close native resources.', { cause: buildError || closeErrors[0] });
    }

    const meta = {
      version: 1,
      generatedAt: new Date().toISOString(),
      model: modelId || null,
      dims: Number.isFinite(Number(dims)) ? Number(dims) : null,
      count: writtenCount,
      expectedCount: writtenCount,
      rowCount: vectorsSource.count,
      metric: resolvedConfig.metric,
      table: tableName,
      embeddingColumn,
      idColumn,
      scale: Number.isFinite(Number(scale)) ? Number(scale) : undefined,
      minVal: Number.isFinite(Number(quantization?.minVal)) ? Number(quantization.minVal) : undefined,
      maxVal: Number.isFinite(Number(quantization?.maxVal)) ? Number(quantization.maxVal) : undefined,
      levels: Number.isFinite(Number(quantization?.levels)) ? Number(quantization.levels) : undefined
      , extensions: { lancePublicationId: publicationId }
    };
    assertLanceDbPayload(stagedDir, { table: tableName, count: writtenCount });
    await writeJsonObjectFile(stagedMetaPath, { fields: meta, atomic: true });
    const publication = await publishLanceDbReplacement({ dir, metaPath, stageRoot, stagedMetaPath, id: publicationId });
    if (publication.cleanupError) logger.warn(`[embeddings] LanceDB published; cleanup pending at ${publication.recoveryPath}: ${publication.cleanupError}`);

    if (emitOutput) {
      const targetLabel = label || variant;
      logger.log(`[embeddings] ${targetLabel}: wrote LanceDB table (${writtenCount} vectors).`);
    }
    return { skipped: false, count: writtenCount, ...(publication.cleanupError ? { publication } : {}) };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let retainedForRecovery = false;
    try {
      const journal = JSON.parse((await readContainedFile(indexDir, `${metaPath}.publication.json`, { maxBytes: 65536 })).toString('utf8'));
      retainedForRecovery = journal.stageRoot === path.basename(stageRoot);
    } catch (error) { retainedForRecovery = error.code !== 'ENOENT'; }
    if (!retainedForRecovery) {
      try { await fs.rm(stageRoot, { recursive: true, force: true }); }
      catch (cleanupError) {
        if (!primaryError) throw cleanupError;
        throw new AggregateError([primaryError, cleanupError],
          `LanceDB build failed; staging cleanup retained at ${stageRoot}`, { cause: primaryError });
      }
    }
  }
}
