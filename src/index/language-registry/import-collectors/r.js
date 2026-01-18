import { lineHasAny, shouldScanLine } from './utils.js';

export const collectRImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['library', 'require']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/\b(?:library|require)\s*\(\s*['"]?([^'"]+)['"]?\s*\)/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
