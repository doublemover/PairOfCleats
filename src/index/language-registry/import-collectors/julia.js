import { lineHasAny, shouldScanLine } from './utils.js';

export const collectJuliaImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['using', 'import', 'include']);
  const addImport = (value) => {
    const token = String(value || '').trim();
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/^\s*(?:using|import)\s+([A-Za-z0-9_.:]+)/);
    if (match?.[1]) addImport(match[1]);
    const includeMatch = line.match(/\binclude\s*\(\s*["']([^"']+)["']/);
    if (includeMatch?.[1]) addImport(includeMatch[1]);
  }
  return Array.from(imports);
};
