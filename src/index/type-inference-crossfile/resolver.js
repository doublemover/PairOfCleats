import { MAX_CANDIDATES_GLOBAL_SCAN, MAX_CANDIDATES_PER_REF } from './constants.js';
import { resolveRelativeImport } from './resolve-relative-import.js';

const toKey = (value) => (value ? String(value) : '');

const leafName = (value) => {
  const text = toKey(value);
  if (!text) return '';
  const parts = text.split(/::|\./).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
};

const resolveOwnedSymbol = entry => {
  const symbol = entry?.symbol || entry?.meta?.symbol || null;
  if (!symbol || typeof symbol !== 'object' || Array.isArray(symbol)) return null;
  const ownerUid = entry.chunkUid, symbolUid = symbol.chunkUid;
  // Legacy entries may supply only one identity. A supplied disagreement or
  // malformed identity must not redirect this definition to another chunk.
  if (ownerUid != null && (typeof ownerUid !== 'string' || !ownerUid.length)) return null;
  if (symbolUid != null && (typeof symbolUid !== 'string' || !symbolUid.length)) return null;
  if (ownerUid != null && symbolUid != null && ownerUid !== symbolUid) return null;
  return symbol;
};

const buildCandidate = (entry) => {
  if (!entry) return null;
  const symbol = resolveOwnedSymbol(entry);
  if (!symbol) return null;
  return {
    symbolId: symbol.symbolId || null,
    chunkUid: symbol.chunkUid || entry.chunkUid || null,
    symbolKey: symbol.symbolKey || null,
    signatureKey: symbol.signatureKey || null,
    kindGroup: symbol.kindGroup || null
  };
};

const defaultDeclarationKinds = new Set(['ExportDefaultFunctionDeclaration', 'ExportDefaultClassDeclaration', 'ExportDefaultFunction']);
const matchesImportedTarget = (entry, importedTarget) => {
  if (!importedTarget) return false;
  const name = entry?.qualifiedName || entry?.name || '';
  if (importedTarget === 'default') return name === 'default' || defaultDeclarationKinds.has(entry?.kind);
  return name === importedTarget || leafName(importedTarget) === importedTarget && leafName(name) === importedTarget;
};

const scoreCandidate = ({ entry, targetName, leaf, kindHint, importedTarget }) => {
  let score = 0;
  const name = entry?.qualifiedName || entry?.name || '';
  if (name === targetName) score += 3;
  if (leaf && leafName(name) === leaf) score += 2;
  if (matchesImportedTarget(entry, importedTarget)) score += 3;
  if (score > 0 && kindHint && entry?.kind && entry.kind === kindHint) score += 1;
  return score;
};

export const buildSymbolIndex = (entries) => {
  const byName = new Map();
  const byFile = new Map();
  for (const entry of entries || []) {
    if (!entry) continue;
    const symbol = resolveOwnedSymbol(entry);
    if (!symbol) continue;
    const name = entry.qualifiedName || entry.name;
    if (name) {
      const list = byName.get(name) || [];
      list.push(entry);
      byName.set(name, list);
      const leaf = leafName(name);
      if (leaf && leaf !== name) {
        const leafList = byName.get(leaf) || [];
        leafList.push(entry);
        byName.set(leaf, leafList);
      }
    }
    if (entry.file) {
      const list = byFile.get(entry.file) || [];
      list.push(entry);
      byFile.set(entry.file, list);
    }
  }
  return { byName, byFile };
};

export const resolveSymbolRef = ({
  targetName,
  kindHint = null,
  fromFile = null,
  fileRelations = null,
  symbolIndex,
  fileSet
}) => {
  const name = toKey(targetName);
  const leaf = leafName(name);
  const candidates = [];
  const importHint = { moduleSpecifier: null, resolvedFile: null };
  let importedName = null;
  let importedTarget = null;
  let narrowedEntries = [];
  let hasImportNarrowing = false;

  if (fileRelations && fromFile) {
    const relation = typeof fileRelations.get === 'function'
      ? fileRelations.get(fromFile)
      : fileRelations[fromFile];
    const bindings = relation?.importBindings || null;
    if (bindings && typeof bindings === 'object') {
      const rootName = name.split(/::|\./)[0] || '';
      const binding = bindings[rootName];
      if (binding && typeof binding.module === 'string') {
        importHint.moduleSpecifier = binding.module;
        if (typeof binding.imported === 'string' && binding.imported) importedName = binding.imported;
        const suffix = name.slice(rootName.length);
        importedTarget = importedName === '*'
          ? suffix.replace(/^(?:\.|::)/u, '') || null
          : importedName === 'default'
            ? suffix ? null : 'default'
            : importedName ? `${importedName}${suffix}` : null;
        const resolvedFile = resolveRelativeImport(fromFile, binding.module, fileSet);
        if (resolvedFile) {
          importHint.resolvedFile = resolvedFile;
          narrowedEntries = symbolIndex?.byFile?.get(resolvedFile) || [];
          hasImportNarrowing = true;
        }
      }
    }
  }

  const baseEntries = hasImportNarrowing
    ? narrowedEntries
    : (symbolIndex?.byName?.get(name) || []);
  const leafEntries = !hasImportNarrowing && leaf && leaf !== name
    ? (symbolIndex?.byName?.get(leaf) || [])
    : [];
  const allEntries = baseEntries.length ? baseEntries : leafEntries;

  for (const entry of allEntries) {
    if (!resolveOwnedSymbol(entry)) continue;
    if (hasImportNarrowing && !matchesImportedTarget(entry, importedTarget)) continue;
    candidates.push(entry);
  }

  const resolvedImportHint = importHint.moduleSpecifier || importHint.resolvedFile ? importHint : null;

  if (candidates.length > MAX_CANDIDATES_GLOBAL_SCAN) {
    const truncated = candidates.slice(0, MAX_CANDIDATES_PER_REF);
    return {
      v: 1,
      targetName: name,
      kindHint,
      importHint: resolvedImportHint,
      candidates: truncated.map(buildCandidate).filter(Boolean),
      status: 'ambiguous',
      resolved: null
    };
  }

  const scored = candidates.map((entry) => ({
    entry,
    score: scoreCandidate({ entry, targetName: name, leaf, kindHint, importedTarget: hasImportNarrowing ? importedTarget : null })
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const keyA = toKey(a.entry?.symbolKey || a.entry?.symbol?.symbolKey);
    const keyB = toKey(b.entry?.symbolKey || b.entry?.symbol?.symbolKey);
    if (keyA !== keyB) return keyA.localeCompare(keyB);
    const uidA = toKey(a.entry?.chunkUid);
    const uidB = toKey(b.entry?.chunkUid);
    return uidA.localeCompare(uidB);
  });

  const top = scored.filter((item) => item.score > 0);
  const limited = top.slice(0, MAX_CANDIDATES_PER_REF);
  const formatted = limited.map(({ entry }) => buildCandidate(entry)).filter(Boolean);

  if (formatted.length === 1) {
    const resolved = formatted[0];
    return {
      v: 1,
      targetName: name,
      kindHint,
      importHint: resolvedImportHint,
      candidates: formatted,
      status: 'resolved',
      resolved: { symbolId: resolved.symbolId, chunkUid: resolved.chunkUid }
    };
  }

  return {
    v: 1,
    targetName: name,
    kindHint,
    importHint: resolvedImportHint,
    candidates: formatted,
    status: formatted.length ? 'ambiguous' : 'unresolved',
    resolved: null
  };
};
