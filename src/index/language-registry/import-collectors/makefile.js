import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

export const collectMakefileImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, ['include', ':']);
  const addImport = (value) => {
    const token = String(value || '').trim();
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const trimmed = line.replace(/#.*$/, '').trim();
    const includeMatch = trimmed.match(/^\s*(?:-?include|sinclude)\s+(.+)$/i);
    if (includeMatch) {
      const includeExpr = includeMatch[1];
      const wildcard = includeExpr.match(/\$\(wildcard\s+([^)]+)\)/i);
      if (wildcard?.[1]) {
        for (const part of wildcard[1].split(/\s+/).filter(Boolean)) addImport(part);
      } else {
        for (const part of includeExpr.split(/\s+/).filter(Boolean)) addImport(part);
      }
    }
    const depMatch = trimmed.match(/^[A-Za-z0-9_./%-]+(?:\s+[A-Za-z0-9_./%-]+)*\s*:\s*([^=].*)$/);
    if (!depMatch) continue;
    const deps = depMatch[1].split(/\s+/).map((entry) => entry.trim()).filter(Boolean);
    for (const dep of deps) {
      if (dep === '|') continue;
      addImport(dep);
    }
  }
  return Array.from(imports);
};
