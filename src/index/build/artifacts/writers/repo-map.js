export const createRepoMapIterator = ({ chunks, fileRelations }) => {
  const fileExportMap = new Map();
  if (fileRelations && fileRelations.size) {
    for (const [file, relations] of fileRelations.entries()) {
      if (!Array.isArray(relations?.exports) || !relations.exports.length) continue;
      fileExportMap.set(file, new Set(relations.exports));
    }
  }
  return function* repoMapIterator() {
    const grouped = new Map();
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
      const entry = {
        file: c.file,
        ext: c.ext,
        name: c.name,
        kind: c.kind,
        signature: c.docmeta?.signature || null,
        startLine: c.startLine,
        endLine: c.endLine,
        exported
      };
      const fileKey = String(entry.file || '');
      const nameKey = String(entry.name || '');
      const kindKey = String(entry.kind || '');
      const groupKey = `${fileKey}\u0000${nameKey}\u0000${kindKey}`;
      let group = grouped.get(groupKey);
      if (!group) {
        group = {
          file: fileKey,
          name: nameKey,
          kind: kindKey,
          entries: [],
          seen: new Set()
        };
        grouped.set(groupKey, group);
      }
      const dedupeKey = [
        fileKey,
        nameKey,
        kindKey,
        entry.signature == null ? '' : String(entry.signature),
        Number.isFinite(entry.startLine) ? entry.startLine : ''
      ].join('::');
      if (group.seen.has(dedupeKey)) continue;
      group.seen.add(dedupeKey);
      group.entries.push(entry);
    }
    const groups = Array.from(grouped.values());
    groups.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.kind.localeCompare(b.kind);
    });
    for (const group of groups) {
      for (const entry of group.entries) {
        yield entry;
      }
    }
  };
};
