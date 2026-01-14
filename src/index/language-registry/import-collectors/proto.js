import { lineHasAny, shouldScanLine } from './utils.js';

export const collectProtoImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['import']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/^\s*import\s+(?:public\s+)?\"([^\"]+)\"/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
