export function buildFileMeta(state) {
  const fileMeta = [];
  const fileIdByPath = new Map();
  for (const c of state.chunks) {
    if (!c?.file) continue;
    if (fileIdByPath.has(c.file)) continue;
    const id = fileMeta.length;
    fileIdByPath.set(c.file, id);
    fileMeta.push({
      id,
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
  return { fileMeta, fileIdByPath };
}
