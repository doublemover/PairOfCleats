import {
  addCollectorImport,
  createCommentAwareLineStripper,
  lineHasAnyInsensitive,
  shouldScanLine
} from './utils.js';

export const collectRazorImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const stripComments = createCommentAwareLineStripper({
    markers: ['//'],
    requireWhitespaceBefore: true
  });
  const precheck = (value) => lineHasAnyInsensitive(value, ['@using']);
  for (const rawLine of lines) {
    if (!shouldScanLine(rawLine, precheck)) continue;
    const line = stripComments(rawLine);
    if (!line.trim()) continue;
    const match = line.match(/^\s*@using\s+(.+)$/i);
    if (match) addCollectorImport(imports, match[1].trim());
  }
  return Array.from(imports);
};
