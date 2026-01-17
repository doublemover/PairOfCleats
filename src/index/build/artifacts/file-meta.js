export function buildFileMeta(state) {
  const fileInfo = new Map();
  for (const c of state.chunks) {
    if (!c?.file) continue;
    if (!fileInfo.has(c.file)) {
      fileInfo.set(c.file, {
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
    const info = fileInfo.get(c.file);
    if (!info.ext && c.ext) info.ext = c.ext;
    if (!info.size && Number.isFinite(c.fileSize)) info.size = c.fileSize;
    if (!info.hash && c.fileHash) info.hash = c.fileHash;
    if (!info.hashAlgo && c.fileHashAlgo) info.hashAlgo = c.fileHashAlgo;
    if (!info.externalDocs && c.externalDocs) info.externalDocs = c.externalDocs;
    if (!info.last_modified && c.last_modified) info.last_modified = c.last_modified;
    if (!info.last_author && c.last_author) info.last_author = c.last_author;
  }
  const fileMeta = [];
  const fileIdByPath = new Map();
  const files = Array.from(fileInfo.keys()).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
  files.forEach((file, id) => {
    fileIdByPath.set(file, id);
    fileMeta.push({ id, ...fileInfo.get(file) });
  });
  return { fileMeta, fileIdByPath };
}
