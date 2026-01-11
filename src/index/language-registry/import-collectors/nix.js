import { normalizeImportToken } from '../simple-relations.js';

export const collectNixImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const match = line.match(/\b(import|callPackage)\s+([^\s;]+)/);
    if (!match) continue;
    const cleaned = normalizeImportToken(match[2]);
    if (cleaned) imports.push(cleaned);
  }
  return imports;
};
