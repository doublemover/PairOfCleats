const nameOf = entry => entry?.qualifiedName || entry?.name || '';
const leafName = name => name.split(/::|\./u).at(-1);
const defaultDeclarationKinds = new Set(['ExportDefaultFunctionDeclaration', 'ExportDefaultClassDeclaration', 'ExportDefaultFunction']);

const matchesLegacyTarget = (entry, target) => {
  if (!target) return false;
  const name = nameOf(entry);
  if (target === 'default') return name === 'default' || defaultDeclarationKinds.has(entry?.kind);
  return name === target || leafName(target) === target && leafName(name) === target;
};
const exportNames = (entry, runtimeOnly) => {
  const evidence = entry?.moduleExports;
  if (!evidence || typeof evidence.exported !== 'boolean' || !Array.isArray(evidence.exportNames)
    || evidence.exported !== (evidence.exportNames.length > 0)
    || evidence.exportNames.some(name => typeof name !== 'string' || !name.length)) return [];
  if (!runtimeOnly || evidence.typeOnlyExportNames === undefined) return evidence.exportNames;
  if (!Array.isArray(evidence.typeOnlyExportNames)
    || evidence.typeOnlyExportNames.some(name => !evidence.exportNames.includes(name))) return [];
  const typeOnly = new Set(evidence.typeOnlyExportNames);
  return evidence.exportNames.filter(name => !typeOnly.has(name));
};
const exportPath = (imported, suffix) => {
  if (imported === '*') {
    const path = suffix.replace(/^(?:\.|::)/u, '');
    const boundary = path.search(/\.|::/u);
    const selected = boundary < 0 ? { name: path, suffix: '' } : { name: path.slice(0, boundary), suffix: path.slice(boundary) };
    return selected.name === 'default' && selected.suffix ? null : selected;
  }
  // Existing default member resolution remains unsupported: a default value is
  // not necessarily the class/object represented by a similarly named chunk.
  return imported === 'default' && suffix ? null : { name: imported, suffix };
};
const containsMember = (owner, member) => [owner.start, owner.end, member.start, member.end]
  .every(Number.isSafeInteger) && owner.start >= 0 && owner.start < owner.end
  && member.start >= owner.start && member.start < member.end && member.end <= owner.end;

/** Import aliases select existing module-export observations before scoring.
 * A member joins only an exact qualified suffix inside that exported owner's
 * source interval. Missing/unknown explicit export evidence cannot act as a
 * kind/name fallback. Rows predating that evidence retain their legacy route.
 */
export const selectImportedTargets = (entries, { imported, suffix, legacyTarget, lookupName = null, runtimeOnly = false }) => {
  const selected = new Set(entries.filter(entry => entry.moduleExports === undefined && matchesLegacyTarget(entry, legacyTarget)));
  const path = exportPath(imported, suffix);
  if (!path?.name) return [...selected];
  for (const owner of entries) {
    if (!exportNames(owner, runtimeOnly).includes(path.name)) continue;
    if (!path.suffix) { selected.add(owner); continue; }
    const target = nameOf(owner) + path.suffix;
    for (const member of lookupName ? lookupName(target) : entries) {
      if (member.file === owner.file && nameOf(member) === target && containsMember(owner, member)) selected.add(member);
    }
  }
  return [...selected];
};
