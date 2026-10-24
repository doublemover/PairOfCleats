import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile } from '../../shared/artifact-io/json.js';
import {
  resolveBinaryArtifactPath,
  resolveDirArtifactPath
} from '../../shared/artifact-io/manifest.js';
import { normalizeDenseVectorMeta, resolveDenseVectorBinaryPayloadPath } from '../../shared/dense-vector-artifacts.js';
import { assertLanceDbPayload, resolveLanceDbPaths } from '../../shared/lancedb.js';
import { addIssue } from './issues.js';
import { validateSchema } from './schema.js';
import { embeddingBindingMismatches } from '../../shared/embedding-generation.js';

const hasJsonVariant = (basePath) => (
  fs.existsSync(basePath)
  || fs.existsSync(`${basePath}.gz`)
  || fs.existsSync(`${basePath}.zst`)
);

const readJsonVariant = (basePath) => (
  hasJsonVariant(basePath) ? readJsonFile(basePath) : null
);

export const validateEmbeddingArtifacts = ({
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
}) => {
  const embeddings = readJsonArtifact('index_state')?.embeddings;
  const readMeta = (name, legacyPath) => strict || manifest?.pieces?.some(piece => piece.name === name)
    ? readJsonArtifact(name) : readJsonVariant(legacyPath);
  const validateBinding = (name, meta) => {
    const mismatches = embeddingBindingMismatches(meta, embeddings);
    if (mismatches.length) addIssue(report, mode, `${name} embedding identity mismatch (${mismatches.join(', ')})`,
      'Rebuild embeddings for this mode.');
  };
  const denseTargets = [
    {
      label: 'dense_vectors',
      metaName: 'dense_vectors_binary_meta',
      binName: 'dense_vectors',
      baseName: 'dense_vectors_uint8',
      metaPath: path.join(dir, 'dense_vectors_uint8.bin.meta.json'),
      binPath: path.join(dir, 'dense_vectors_uint8.bin')
    },
    {
      label: 'dense_vectors_doc',
      metaName: 'dense_vectors_doc_binary_meta',
      binName: 'dense_vectors_doc',
      baseName: 'dense_vectors_doc_uint8',
      metaPath: path.join(dir, 'dense_vectors_doc_uint8.bin.meta.json'),
      binPath: path.join(dir, 'dense_vectors_doc_uint8.bin')
    },
    {
      label: 'dense_vectors_code',
      metaName: 'dense_vectors_code_binary_meta',
      binName: 'dense_vectors_code',
      baseName: 'dense_vectors_code_uint8',
      metaPath: path.join(dir, 'dense_vectors_code_uint8.bin.meta.json'),
      binPath: path.join(dir, 'dense_vectors_code_uint8.bin')
    }
  ];
  for (const target of denseTargets) {
    const denseMetaRaw = readMeta(target.metaName, target.metaPath);
    if (!denseMetaRaw) continue;
    const denseMeta = normalizeDenseVectorMeta(denseMetaRaw) || denseMetaRaw;
    validateBinding(target.metaName, denseMeta);
    validateSchema(
      report,
      mode,
      target.metaName,
      denseMeta,
      'Rebuild embeddings for this mode.',
      { strictSchema: strict }
    );
    const denseDims = Number.isFinite(Number(denseMeta?.dims))
      ? Math.max(0, Math.floor(Number(denseMeta.dims)))
      : 0;
    const denseCount = Number.isFinite(Number(denseMeta?.count))
      ? Math.max(0, Math.floor(Number(denseMeta.count)))
      : chunkMeta.length;
    validateManifestCount(target.metaName, denseCount, `${target.label} meta`);
    validateManifestCount(target.binName, denseCount, `${target.label} bin`);
    if (denseCount !== chunkMeta.length) {
      const issue = `${target.label} count mismatch (${denseCount} !== ${chunkMeta.length})`;
      modeReport.ok = false;
      modeReport.missing.push(issue);
      report.issues.push(`[${mode}] ${issue}`);
    }
    if (!denseDims) {
      addIssue(report, mode, `${target.label} dims missing from binary metadata`, 'Rebuild embeddings for this mode.');
      continue;
    }
    let denseBinPath;
    try {
      denseBinPath = resolveDenseVectorBinaryPayloadPath({ dir, baseName: target.baseName, meta: denseMeta, manifest, strict });
    } catch (error) {
      addIssue(report, mode, `${target.label} binary path invalid: ${error.message}`, 'Rebuild embeddings for this mode.');
      continue;
    }
    if (!denseBinPath || !fs.existsSync(denseBinPath)) {
      addIssue(report, mode, `${target.label} binary payload missing`, 'Rebuild embeddings for this mode.');
      continue;
    }
    try {
      const denseStat = fs.statSync(denseBinPath);
      const expectedBytes = denseDims * denseCount;
      if (denseStat.size < expectedBytes) {
        addIssue(
          report,
          mode,
          `${target.label} binary too small (${denseStat.size} < ${expectedBytes})`,
          'Rebuild embeddings for this mode.'
        );
      }
    } catch {
      addIssue(report, mode, `${target.label} binary stat failed`, 'Rebuild embeddings for this mode.');
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
    const hnswMeta = readMeta(target.metaName, target.metaPath);
    if (!hnswMeta) continue;
    validateBinding(target.metaName, hnswMeta);
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
    // HNSW omits empty/missing vectors. count is successful insertions and
    // expectedCount is attempted nonempty insertions for this exact target,
    // not the dense storage row count. Legacy metadata can lack occupancy.
    const expectedCount = Number.isInteger(hnswMeta?.expectedCount) && hnswMeta.expectedCount >= 0
      ? hnswMeta.expectedCount
      : null;
    const validCount = Number.isInteger(hnswMeta?.count) && hnswMeta.count >= 0;
    const exceedsRows = validCount && hnswMeta.count > chunkMeta.length;
    const incomplete = validCount && expectedCount !== null && hnswMeta.count !== expectedCount;
    if (exceedsRows || incomplete) {
      const detail = exceedsRows
        ? `${hnswMeta.count} > ${chunkMeta.length} chunk rows`
        : `${hnswMeta.count} !== ${expectedCount} expected nonempty vectors`;
      const issue = `${target.label} count mismatch (${detail})`;
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
      const meta = readMeta(target.metaName, target.metaPath);
      if (!meta) continue;
      validateBinding(target.metaName, meta);
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
      const expectedCount = Number.isInteger(meta?.expectedCount) && meta.expectedCount >= 0
        ? meta.expectedCount : chunkMeta.length;
      if (Number.isFinite(meta?.count) && (meta.count !== expectedCount || meta.count > chunkMeta.length)) {
        const issue = `${target.label} count mismatch (${meta.count} !== ${expectedCount} expected nonempty vectors; ${chunkMeta.length} chunk rows)`;
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
      } else {
        try { assertLanceDbPayload(lanceDir, { table: meta.table || lanceConfig.table, count: lanceCount }); }
        catch (error) {
          addIssue(report, mode, `${target.label} payload invalid: ${error.message}`, 'Rebuild embeddings for this mode.');
        }
      }
    }
  }

  const sqliteVecMeta = strict
    ? readJsonArtifact('dense_vectors_sqlite_vec_meta')
    : (() => {
      const sqliteMetaPath = path.join(dir, 'dense_vectors_sqlite_vec.meta.json');
      return readJsonVariant(sqliteMetaPath);
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
};
