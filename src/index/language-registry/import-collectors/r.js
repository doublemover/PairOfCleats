import { lineHasAny, shouldScanLine, stripInlineCommentAware } from './utils.js';

export const collectRImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['library', 'require', 'source']);
  const addImport = (value) => {
    const token = String(value || '').trim();
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const cleaned = stripInlineCommentAware(line, { markers: ['#'] });
    if (!cleaned.trim()) continue;
    const library = cleaned.match(/\b(?:library|require)\s*\(\s*['"]?([^'")]+)['"]?\s*\)/);
    if (library?.[1]) addImport(library[1]);
    const namespace = cleaned.match(/\brequireNamespace\s*\(\s*['"]([^'"]+)['"]/);
    if (namespace?.[1]) addImport(namespace[1]);
    const sourceMatch = cleaned.match(/\bsource\s*\(\s*['"]([^'"]+)['"]/);
    if (sourceMatch?.[1]) addImport(sourceMatch[1]);
  }
  return Array.from(imports);
};
