import { lineHasAny, shouldScanLine } from './utils.js';

export const collectJinjaImports = (text) => {
  const imports = [];
  const lines = String(text || '').split('\n');
  const precheck = (value) =>
    value.includes('{%') && lineHasAny(value, ['extends', 'include', 'import']);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/{%\s*(?:extends|include|import)\s+['"]([^'"]+)['"]/);
    if (match) imports.push(match[1]);
  }
  return imports;
};
