import { lineHasAny, sanitizeCollectorImportToken, shouldScanLine } from './utils.js';

export const collectJinjaImports = (text) => {
  const imports = new Set();
  const source = String(text || '');
  const lines = source.split('\n');
  const precheck = (value) =>
    value.includes('{%') && lineHasAny(value, ['extends', 'include', 'import']);
  const addImport = (value) => {
    const token = sanitizeCollectorImportToken(value);
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/{%\s*(?:extends|include|import)\s+['"]([^'"]+)['"]/);
    if (match?.[1]) addImport(match[1]);
  }
  const multilineMatches = source.matchAll(/{%\s*(?:extends|include|import)\s+["']([^"']+)["'][\s\S]*?%}/g);
  for (const match of multilineMatches) {
    if (match?.[1]) addImport(match[1]);
  }
  return Array.from(imports);
};
