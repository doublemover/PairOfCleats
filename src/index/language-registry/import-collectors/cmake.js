import { normalizeImportToken } from '../simple-relations.js';
import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

export const collectCmakeImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) =>
    lineHasAnyInsensitive(value, [
      'include',
      'add_subdirectory',
      'find_package',
      'target_link_libraries',
      'add_dependencies'
    ]);
  const addImport = (value) => {
    const cleaned = normalizeImportToken(value);
    if (!cleaned) return;
    imports.add(cleaned);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*(include|add_subdirectory|find_package|target_link_libraries|add_dependencies)\s*\(\s*([^)]+)\)/i);
    if (!match) continue;
    const command = String(match[1] || '').toLowerCase();
    const args = match[2].trim().split(/\s+/).filter(Boolean);
    if (!args.length) continue;
    if (command === 'target_link_libraries') {
      const scopeKeywords = new Set(['private', 'public', 'interface', 'link_private', 'link_public']);
      for (const entry of args.slice(1)) {
        if (scopeKeywords.has(String(entry).toLowerCase())) continue;
        addImport(entry);
      }
      continue;
    }
    if (command === 'add_dependencies') {
      for (const entry of args.slice(1)) addImport(entry);
      continue;
    }
    addImport(args[0]);
  }
  return Array.from(imports);
};
