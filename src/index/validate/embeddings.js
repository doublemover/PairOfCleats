import fs from 'node:fs';
import path from 'node:path';
import {
  readJsonFile,
  resolveBinaryArtifactPath,
  resolveDirArtifactPath
} from '../../shared/artifact-io.js';
import { normalizeDenseVectorMeta } from '../../shared/dense-vector-artifacts.js';
import { joinPathSafe } from '../../shared/path-normalize.js';
import { resolveLanceDbPaths } from '../../shared/lancedb.js';
import { addIssue } from './issues.js';
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
    const denseMetaRaw = strict
      ? readJsonArtifact(target.metaName)
      : readJsonVariant(target.metaPath);
    if (!denseMetaRaw) continue;
    const denseMeta = normalizeDenseVectorMeta(denseMetaRaw) || denseMetaRaw;
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
    const binPathFromMeta = (() => {
      const relPath = typeof denseMeta?.path === 'string' && denseMeta.path
        ? denseMeta.path
        : `${target.baseName}.bin`;
      return joinPathSafe(dir, [relPath]);
    })();
    if (typeof denseMeta?.path === 'string' && denseMeta.path && !binPathFromMeta) {
      addIssue(report, mode, `${target.label} binary path invalid`, 'Rebuild embeddings for this mode.');
      continue;
    }
    const denseBinPath = binPathFromMeta || resolveBinaryArtifactPath(dir, target.binName, {
      manifest,
      strict,
      fallbackPath: target.binPath
    });
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
