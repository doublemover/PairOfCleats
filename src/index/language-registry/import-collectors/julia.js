import { lineHasAny, shouldScanLine, stripInlineCommentAware } from './utils.js';

export const collectJuliaImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['using', 'import', 'include']);
  const addImport = (value) => {
    const token = String(value || '').trim();
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const cleaned = stripInlineCommentAware(line, { markers: ['#'] });
    if (!cleaned.trim()) continue;
    const importMatch = cleaned.match(/^\s*(?:using|import)\s+(.+)$/);
    if (importMatch?.[1]) {
      const modules = importMatch[1]
        .split(',')
        .map((entry) => entry.trim().split(':')[0].trim())
        .map((entry) => entry.replace(/^\.+/, ''))
        .filter(Boolean);
      for (const moduleName of modules) {
        if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(moduleName)) addImport(moduleName);
      }
    }
    const includeMatch = cleaned.match(/\binclude\s*\(\s*["']([^"']+)["']/);
    if (includeMatch?.[1]) addImport(includeMatch[1]);
  }
  return Array.from(imports);
};
