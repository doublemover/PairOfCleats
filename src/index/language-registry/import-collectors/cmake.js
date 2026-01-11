import { normalizeImportToken } from '../simple-relations.js';

export const collectCmakeImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*(include|add_subdirectory|find_package)\s*\(\s*([^)]+)\)/i);
    if (!match) continue;
    const arg = match[2].trim().split(/\s+/)[0];
    const cleaned = normalizeImportToken(arg);
    if (cleaned) imports.push(cleaned);
  }
  return imports;
};
