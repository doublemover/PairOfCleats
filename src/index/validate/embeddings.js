import fs from 'node:fs';
import path from 'node:path';
import {
  readJsonFile,
  resolveBinaryArtifactPath,
  resolveDirArtifactPath
} from '../../shared/artifact-io.js';
import { resolveLanceDbPaths } from '../../shared/lancedb.js';
import { addIssue } from './issues.js';
import { normalizeDenseVectors } from './normalize.js';
import { validateSchema } from './schema.js';

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
        return readJsonVariant(densePath);
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
      : readJsonVariant(target.metaPath);
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
        : readJsonVariant(target.metaPath);
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
