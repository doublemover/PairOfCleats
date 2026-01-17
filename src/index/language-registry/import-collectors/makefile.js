import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

export const collectMakefileImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, ['include']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const trimmed = line.replace(/#.*$/, '').trim();
    const match = trimmed.match(/^\s*-?include\s+(.+)$/i);
    if (!match) continue;
    const parts = match[1].split(/\s+/).filter(Boolean);
    imports.push(...parts);
  }
  return imports;
};
