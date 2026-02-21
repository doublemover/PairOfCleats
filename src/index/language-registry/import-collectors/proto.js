import { lineHasAny, shouldScanLine } from './utils.js';

export const collectProtoImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['import']);
  const addImport = (value) => {
    const token = String(value || '').trim();
    if (!token) return;
    imports.add(token);
  };
  let inBlockComment = false;
  for (const line of lines) {
    if (!shouldScanLine(line, precheck) && !inBlockComment) continue;
    const source = String(line || '');
    const trimmed = source.trim();
    if (!trimmed) continue;
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('//')) continue;
    const blockStart = trimmed.indexOf('/*');
    if (blockStart === 0) {
      inBlockComment = !trimmed.includes('*/');
      continue;
    }
    const lineWithoutInlineComment = source.replace(/\/\/.*$/, '').replace(/\/\*.*$/, '');
    const importMatch = lineWithoutInlineComment.match(/^\s*import\s+(?:public\s+|weak\s+)?\"([^\"]+)\"/);
    if (importMatch?.[1]) addImport(importMatch[1]);
    if (blockStart >= 0 && !trimmed.includes('*/')) {
      inBlockComment = true;
    }
  }
  return Array.from(imports);
};
