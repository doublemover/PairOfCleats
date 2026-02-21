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
    const match = line.match(/^\s*#\s*import\s+\"([^\"]+)\"/i);
    if (match?.[1]) addImport(match[1]);
    const linkUrl = line.match(/@link\s*\([^)]*\burl\s*:\s*\"([^\"]+)\"/i);
    if (linkUrl?.[1]) addImport(linkUrl[1]);
  }
  return Array.from(imports);
};
