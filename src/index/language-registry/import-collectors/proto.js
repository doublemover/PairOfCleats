import {
  addCollectorImport,
  createCommentAwareLineStripper,
  lineHasAny,
  shouldScanLine
} from './utils.js';

export const collectProtoImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const stripComments = createCommentAwareLineStripper({
    markers: ['//'],
    blockCommentPairs: [['/*', '*/']],
    requireWhitespaceBefore: true
  });
  const precheck = (value) => lineHasAny(value, ['import']);
  for (const rawLine of lines) {
    const line = stripComments(rawLine);
    if (!shouldScanLine(line, precheck)) continue;
    if (!line.trim()) continue;
    const importMatch = line.match(/^\s*import\s+(?:public\s+|weak\s+)?\"([^\"]+)\"/);
    if (importMatch?.[1]) addCollectorImport(imports, importMatch[1]);
  }
  return Array.from(imports);
};
