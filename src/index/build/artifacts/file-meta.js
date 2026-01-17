export function buildFileMeta(state) {
  const fileMeta = [];
  const fileIdByPath = new Map();
  const fileInfoByPath = state?.fileInfoByPath;
  const fileDetails = new Map();
  for (const c of state.chunks) {
    if (!c?.file) continue;
    if (fileDetails.has(c.file)) continue;
    fileDetails.set(c.file, {
      file: c.file,
      ext: c.ext,
      externalDocs: c.externalDocs,
      last_modified: c.last_modified,
      last_author: c.last_author,
      churn: c.churn,
      churn_added: c.churn_added,
      churn_deleted: c.churn_deleted,
      churn_commits: c.churn_commits
    });
  }
  const files = Array.from(fileDetails.keys()).sort();
  for (const file of files) {
    const entry = fileDetails.get(file) || { file };
    const info = fileInfoByPath?.get?.(file) || null;
    const id = fileMeta.length;
    fileIdByPath.set(file, id);
    fileMeta.push({
      id,
      file: entry.file,
      ext: entry.ext,
      externalDocs: entry.externalDocs,
      last_modified: entry.last_modified,
      last_author: entry.last_author,
      churn: entry.churn,
      churn_added: entry.churn_added,
      churn_deleted: entry.churn_deleted,
      churn_commits: entry.churn_commits,
      size: Number.isFinite(info?.size) ? info.size : null,
      hash: info?.hash || null,
      hash_algo: info?.hashAlgo || null
    });
  }
  return { fileMeta, fileIdByPath };
}
