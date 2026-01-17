import { normalizeImportToken } from '../simple-relations.js';
import { lineHasAny, shouldScanLine } from './utils.js';

export const collectNixImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['import', 'callPackage']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/\b(import|callPackage)\s+([^\s;]+)/);
    if (!match) continue;
    const cleaned = normalizeImportToken(match[2]);
    if (cleaned) imports.push(cleaned);
  }
  return imports;
};
