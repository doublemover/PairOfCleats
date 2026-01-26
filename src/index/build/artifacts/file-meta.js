export function buildFileMeta(state) {
  const fileMeta = [];
  const fileIdByPath = new Map();
  const fileInfoByPath = state?.fileInfoByPath;
  const fileDetails = new Map();
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
  const files = Array.from(fileDetails.keys()).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  for (const file of files) {
    const entry = fileDetails.get(file) || { file };
    const info = fileInfoByPath?.get?.(file) || null;
    const id = fileMeta.length;
    fileIdByPath.set(file, id);
    fileMeta.push({
      id,
      file: entry.file,
      ext: entry.ext,
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
  return { fileMeta, fileIdByPath };
}
