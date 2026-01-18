import { lineHasAny, shouldScanLine } from './utils.js';

export const collectMustacheImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['{{>']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/{{>\s*([A-Za-z0-9_.-]+)\b/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
