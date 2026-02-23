import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { replaceFile } from '../../../../src/shared/json-stream.js';

const BACKEND_ARTIFACT_RELATIVE_PATHS = [
  'dense_vectors_hnsw.bin',
  'dense_vectors_hnsw.meta.json',
  'dense_vectors_doc_hnsw.bin',
  'dense_vectors_doc_hnsw.meta.json',
  'dense_vectors_code_hnsw.bin',
  'dense_vectors_code_hnsw.meta.json',
  'dense_vectors.lancedb',
  'dense_vectors.lancedb.meta.json',
  'dense_vectors_doc.lancedb',
  'dense_vectors_doc.lancedb.meta.json',
  'dense_vectors_code.lancedb',
  'dense_vectors_code.lancedb.meta.json'
];

/**
 * Check whether artifact file exists in raw/compressed/backup forms.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
const hasArtifactFile = (filePath) => (
  fsSync.existsSync(filePath)
  || fsSync.existsSync(`${filePath}.gz`)
  || fsSync.existsSync(`${filePath}.zst`)
  || fsSync.existsSync(`${filePath}.bak`)
);

/**
 * Create trace helpers for embeddings artifact discovery diagnostics.
 *
 * @param {{traceArtifactIo:boolean,log:(line:string)=>void}} input
 * @returns {{logArtifactLocation:(mode:string,label:string,filePath:string)=>void,logExpectedArtifacts:(mode:string,indexDir:string,stageLabel:string)=>void}}
 */
export const createArtifactTraceLogger = ({ traceArtifactIo, log }) => {
  /**
   * Emit trace-level artifact existence line when IO tracing is enabled.
   *
   * @param {string} mode
   * @param {string} label
   * @param {string} filePath
   * @returns {void}
   */
  const logArtifactLocation = (mode, label, filePath) => {
    if (!traceArtifactIo) return;
    const exists = hasArtifactFile(filePath);
    log(`[embeddings] ${mode}: artifact ${label} path=${filePath} exists=${exists}`);
  };
  /**
   * Log expected stage artifacts snapshot for debug traceability.
   *
   * @param {string} mode
   * @param {string} indexDir
   * @param {string} stageLabel
   * @returns {void}
   */
  const logExpectedArtifacts = (mode, indexDir, stageLabel) => {
    if (!traceArtifactIo) return;
    const expected = [
      { label: 'chunk_meta', path: path.join(indexDir, 'chunk_meta.json') },
      { label: 'chunk_meta_stream', path: path.join(indexDir, 'chunk_meta.jsonl') },
      { label: 'chunk_meta_meta', path: path.join(indexDir, 'chunk_meta.meta.json') },
      { label: 'token_postings', path: path.join(indexDir, 'token_postings.json') },
      { label: 'token_postings_stream', path: path.join(indexDir, 'token_postings.jsonl') },
      { label: 'token_postings_meta', path: path.join(indexDir, 'token_postings.meta.json') },
      { label: 'phrase_ngrams', path: path.join(indexDir, 'phrase_ngrams.json') },
      { label: 'chargram_postings', path: path.join(indexDir, 'chargram_postings.json') },
      { label: 'index_state', path: path.join(indexDir, 'index_state.json') },
      { label: 'filelists', path: path.join(indexDir, '.filelists.json') },
      { label: 'pieces_manifest', path: path.join(indexDir, 'pieces', 'manifest.json') }
    ];
    log(`[embeddings] ${mode}: expected artifact snapshot (${stageLabel})`);
    for (const entry of expected) {
      logArtifactLocation(mode, `${stageLabel}:${entry.label}`, entry.path);
    }
  };
  return {
    logArtifactLocation,
    logExpectedArtifacts
  };
};

/**
 * Promote backend-only artifacts from a staging directory into the active
 * index directory. Stage3 uses this to isolate backend writers from the core
 * stage2 artifact surface and then copy only ANN outputs back.
 *
 * @param {{stageDir:string,indexDir:string}} input
 * @returns {Promise<void>}
 */
export const promoteBackendArtifacts = async ({ stageDir, indexDir }) => {
  for (const relPath of BACKEND_ARTIFACT_RELATIVE_PATHS) {
    const sourcePath = path.join(stageDir, relPath);
    if (!fsSync.existsSync(sourcePath)) continue;
    const targetPath = path.join(indexDir, relPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const stat = await fs.lstat(sourcePath).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      await fs.rm(targetPath, { recursive: true, force: true });
      try {
        await fs.rename(sourcePath, targetPath);
      } catch (err) {
        if (!['EXDEV', 'EPERM', 'EACCES'].includes(err?.code)) throw err;
        await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
        await fs.rm(sourcePath, { recursive: true, force: true });
      }
    } else {
      try {
        await fs.rm(`${targetPath}.bak`, { force: true });
      } catch {}
      await replaceFile(sourcePath, targetPath, { keepBackup: true });
    }
  }
};
