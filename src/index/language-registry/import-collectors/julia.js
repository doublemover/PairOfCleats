import { lineHasAny, shouldScanLine } from './utils.js';

export const collectJuliaImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['using', 'import']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/^\s*(?:using|import)\s+([A-Za-z0-9_.:]+)/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
