import { lineHasAny, shouldScanLine } from './utils.js';

export const collectGroovyImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['import', 'package', 'extends', 'implements']);
  const addImport = (value) => {
    const token = String(value || '').trim().replace(/[;]+$/g, '');
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const importMatch = line.match(/^\s*import\s+([^\s;]+)/);
    if (importMatch?.[1]) addImport(importMatch[1]);
    const packageMatch = line.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)/);
    if (packageMatch?.[1]) addImport(packageMatch[1]);
    const extendsMatches = line.matchAll(/\b(?:extends|implements)\s+([A-Za-z_][A-Za-z0-9_.]*)/g);
    for (const match of extendsMatches) {
      if (match?.[1]) addImport(match[1]);
    }
  }
  return Array.from(imports);
};
