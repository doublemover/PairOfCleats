import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

export const collectGraphqlImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, ['#import', '@link', 'import']);
  const addImport = (value) => {
    const token = String(value || '').trim();
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const importMatches = line.matchAll(/^\s*#\s*import\s+["']([^"']+)["']/gim);
    for (const match of importMatches) {
      if (match?.[1]) addImport(match[1]);
    }
    const linkUrls = line.matchAll(/@link\s*\([^)]*\burl\s*:\s*["']([^"']+)["']/gi);
    for (const match of linkUrls) {
      if (match?.[1]) addImport(match[1]);
    }
  }
  return Array.from(imports);
};
