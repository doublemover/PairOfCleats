import { lineHasAny, shouldScanLine } from './utils.js';

export const collectStarlarkImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['load']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    if (line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*load\s*\(\s*['"]([^'"]+)['"]/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
