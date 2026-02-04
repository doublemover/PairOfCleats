import { sha1 } from '../../../shared/hash.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { fileExt } from '../../../shared/files.js';

export const computeFileMetaFingerprint = ({ files, fileInfoByPath }) => {
  const list = files.map((file) => {
    const info = fileInfoByPath?.get?.(file) || null;
    return {
      file,
      size: Number.isFinite(info?.size) ? info.size : null,
      hash: info?.hash || null,
      hashAlgo: info?.hashAlgo || null
    };
  });
  return sha1(stableStringifyForSignature(list));
};

export function buildFileMeta(state) {
  const fileMeta = [];
  const fileIdByPath = new Map();
  const fileInfoByPath = state?.fileInfoByPath;
  const fileDetailsByPath = state?.fileDetailsByPath;
  const fileDetails = new Map();
  if (fileDetailsByPath && typeof fileDetailsByPath.entries === 'function') {
    for (const [file, info] of fileDetailsByPath.entries()) {
      fileDetails.set(file, { ...(info || {}), file });
    }
  }
  if (!fileDetails.size) {
    for (const c of state.chunks) {
      if (!c?.file) continue;
      if (!fileDetails.has(c.file)) {
        fileDetails.set(c.file, {
          file: c.file,
          ext: c.ext,
          size: Number.isFinite(c.fileSize) ? c.fileSize : null,
          hash: c.fileHash || null,
          hashAlgo: c.fileHashAlgo || null,
          externalDocs: c.externalDocs,
          last_modified: c.last_modified,
          last_author: c.last_author,
          churn: c.churn,
          churn_added: c.churn_added,
          churn_deleted: c.churn_deleted,
          churn_commits: c.churn_commits
        });
        continue;
      }
      const info = fileDetails.get(c.file);
      if (!info.ext && c.ext) info.ext = c.ext;
      if (!info.size && Number.isFinite(c.fileSize)) info.size = c.fileSize;
      if (!info.hash && c.fileHash) info.hash = c.fileHash;
      if (!info.hashAlgo && c.fileHashAlgo) info.hashAlgo = c.fileHashAlgo;
      if (!info.externalDocs && c.externalDocs) info.externalDocs = c.externalDocs;
      if (!info.last_modified && c.last_modified) info.last_modified = c.last_modified;
      if (!info.last_author && c.last_author) info.last_author = c.last_author;
    }
  }
  const discoveredFiles = Array.isArray(state?.discoveredFiles) ? state.discoveredFiles : null;
  const files = discoveredFiles && discoveredFiles.length
    ? discoveredFiles.slice()
    : Array.from(fileDetails.keys()).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  if (fileInfoByPath && typeof fileInfoByPath.keys === 'function') {
    for (const file of fileInfoByPath.keys()) {
      if (!files.includes(file)) files.push(file);
    }
  }
  for (const file of files) {
    const entry = fileDetails.get(file) || { file, ext: fileExt(file) };
    const info = fileInfoByPath?.get?.(file) || null;
    const id = fileMeta.length;
    fileIdByPath.set(file, id);
    fileMeta.push({
      id,
      file: entry.file,
      ext: entry.ext || fileExt(entry.file),
      size: Number.isFinite(info?.size) ? info.size : entry.size,
      hash: info?.hash || entry.hash || null,
      hashAlgo: info?.hashAlgo || entry.hashAlgo || null,
      encoding: info?.encoding || null,
      encodingFallback: typeof info?.encodingFallback === 'boolean' ? info.encodingFallback : null,
      encodingConfidence: Number.isFinite(info?.encodingConfidence) ? info.encodingConfidence : null,
      externalDocs: entry.externalDocs,
      last_modified: entry.last_modified,
      last_author: entry.last_author,
      churn: entry.churn,
      churn_added: entry.churn_added,
      churn_deleted: entry.churn_deleted,
      churn_commits: entry.churn_commits
    });
  }
  const fingerprint = computeFileMetaFingerprint({ files, fileInfoByPath });
  return { fileMeta, fileIdByPath, fingerprint };
}
