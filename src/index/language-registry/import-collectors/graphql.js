import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

export const collectGraphqlImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, ['#import']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/^\s*#import\s+\"([^\"]+)\"/i);
    if (match) imports.push(match[1]);
  }
  return imports;
};
