export const createRepoMapIterator = ({ chunks, fileRelations }) => {
  const fileExportMap = new Map();
  if (fileRelations && fileRelations.size) {
    for (const [file, relations] of fileRelations.entries()) {
      if (!Array.isArray(relations?.exports) || !relations.exports.length) continue;
      fileExportMap.set(file, new Set(relations.exports));
    }
  }
  return function* repoMapIterator() {
    const entries = [];
    for (const c of chunks) {
      if (!c?.name) continue;
      const exportsSet = fileExportMap.get(c.file) || null;
      const hasDefault = exportsSet ? exportsSet.has('default') : false;
      const exported = exportsSet
        ? exportsSet.has(c.name)
          || exportsSet.has('*')
          || (hasDefault && (
            c.name === 'default'
            || c.name === 'module.exports'
            || (typeof c.kind === 'string' && c.kind.startsWith('ExportDefault'))
          ))
        : false;
      entries.push({
        file: c.file,
        ext: c.ext,
        name: c.name,
        kind: c.kind,
        signature: c.docmeta?.signature || null,
        startLine: c.startLine,
        endLine: c.endLine,
        exported
      });
    }
    entries.sort((a, b) => {
      const fileA = String(a.file || '');
      const fileB = String(b.file || '');
      if (fileA !== fileB) return fileA.localeCompare(fileB);
      const nameA = String(a.name || '');
      const nameB = String(b.name || '');
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      const kindA = String(a.kind || '');
      const kindB = String(b.kind || '');
      return kindA.localeCompare(kindB);
    });
    const seen = new Set();
    for (const entry of entries) {
      const key = [
        entry.file,
        entry.name,
        entry.kind,
        entry.signature,
        entry.startLine
      ].map((value) => (value == null ? '' : String(value))).join('::');
      if (seen.has(key)) continue;
      seen.add(key);
      yield entry;
    }
  };
};
