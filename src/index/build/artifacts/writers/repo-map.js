export const createRepoMapIterator = ({ chunks, fileRelations }) => {
  const fileExportMap = new Map();
  if (fileRelations && fileRelations.size) {
    for (const [file, relations] of fileRelations.entries()) {
      if (!Array.isArray(relations?.exports) || !relations.exports.length) continue;
      fileExportMap.set(file, new Set(relations.exports));
    }
  }
  return function* repoMapIterator() {
    for (const c of chunks) {
      if (!c?.name) continue;
      const exportsSet = fileExportMap.get(c.file) || null;
      const exported = exportsSet
        ? exportsSet.has(c.name) || exportsSet.has('*') || (c.name === 'default' && exportsSet.has('default'))
        : false;
      yield {
        file: c.file,
        ext: c.ext,
        name: c.name,
        kind: c.kind,
        signature: c.docmeta?.signature || null,
        startLine: c.startLine,
        endLine: c.endLine,
        exported
      };
    }
  };
};
