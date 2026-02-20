import { normalizeImportToken } from '../simple-relations.js';
import { lineHasAny, shouldScanLine } from './utils.js';

export const collectNixImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, [
    'import',
    'callPackage',
    'imports',
    'inputs.',
    'getFlake',
    '.nix'
  ]);
  const addImport = (value) => {
    const cleaned = normalizeImportToken(value);
    if (cleaned) imports.add(cleaned);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const importMatch = line.match(/\b(import|callPackage)\s+([^\s;]+)/);
    if (importMatch?.[2]) addImport(importMatch[2]);
    const getFlakeMatch = line.match(/\bbuiltins\.getFlake\s+([^\s;]+)/);
    if (getFlakeMatch?.[1]) addImport(getFlakeMatch[1]);
    const flakeInputMatch = line.match(/\binputs\.[A-Za-z_][A-Za-z0-9_-]*\.(?:url|path|follows)\s*=\s*([^\s;]+)/);
    if (flakeInputMatch?.[1]) addImport(flakeInputMatch[1]);
    const pathMatches = line.match(/\.\.?\/[A-Za-z0-9_.\/-]+\.nix\b/g);
    for (const entry of pathMatches || []) addImport(entry);
  }
  return Array.from(imports);
};
