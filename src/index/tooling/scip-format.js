/** Legacy flat projection helpers. Kept permissive for CLI compatibility; rich
 * semantic import performs separate strict source/encoding/identity admission. */
export const scipRoleInfo = roles => {
  const parsed = Number(roles), symbolRoles = Number.isInteger(parsed) ? parsed : 0;
  const isDefinition = (symbolRoles & 1) !== 0;
  return { symbolRoles, isDefinition, isReference: !isDefinition, isImport: (symbolRoles & 2) !== 0,
    isWriteAccess: (symbolRoles & 4) !== 0, isReadAccess: (symbolRoles & 8) !== 0,
    isGenerated: (symbolRoles & 16) !== 0, isTest: (symbolRoles & 32) !== 0, isForwardDefinition: (symbolRoles & 64) !== 0 };
};
export const normalizeScipFlatRange = range => {
  if (!Array.isArray(range) || !range.length) return null;
  const startLine = Number.isFinite(Number(range[0])) ? Number(range[0]) : 0;
  const startChar = Number.isFinite(Number(range[1])) ? Number(range[1]) : 0;
  let endLine = startLine, endChar = startChar;
  if (range.length === 3) endChar = Number.isFinite(Number(range[2])) ? Number(range[2]) : endChar;
  else if (range.length >= 4) {
    endLine = Number.isFinite(Number(range[2])) ? Number(range[2]) : endLine;
    endChar = Number.isFinite(Number(range[3])) ? Number(range[3]) : endChar;
  }
  return { startLine: startLine + 1, startChar, endLine: endLine + 1, endChar };
};
export const extractScipSymbolInfo = doc => {
  const entries = doc?.symbols || doc?.symbolInformation || doc?.symbolInformations || [];
  if (!Array.isArray(entries) || !entries.length) return new Map();
  const map = new Map();
  for (const entry of entries) if (entry?.symbol) map.set(entry.symbol, entry);
  return map;
};
