import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

export const collectRazorImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, ['@using']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/^\s*@using\s+(.+)$/i);
    if (match) imports.push(match[1].trim());
  }
  return imports;
};
