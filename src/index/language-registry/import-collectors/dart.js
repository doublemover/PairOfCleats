import { createCommentAwareLineStripper, lineHasAny, shouldScanLine } from './utils.js';

export const collectDartImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['import', 'export', 'part']);
  const addImport = (value) => {
    const token = String(value || '').trim();
    if (!token) return;
    imports.add(token);
  };
  const stripComments = createCommentAwareLineStripper({ markers: ['//'], blockCommentPairs: [['/*','*/']], nestedBlockComments: true });
  for (const rawLine of lines) {
    const line = stripComments(rawLine);
    if (!shouldScanLine(line, precheck)) continue;
    const match = line.match(/^\s*(import|export|part)\s+['"]([^'"]+)['"]/);
    if (match?.[2]) addImport(match[2]);
    const partOf = line.match(/^\s*part\s+of\s+['"]([^'"]+)['"]/);
    if (partOf?.[1]) addImport(partOf[1]);
  }
  return Array.from(imports);
};
