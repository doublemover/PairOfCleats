import { lineHasAny, shouldScanLine } from './utils.js';

export const collectProtoImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, ['import', 'package', 'option']);
  const addImport = (value) => {
    const token = String(value || '').trim();
    if (!token) return;
    imports.add(token);
  };
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    const importMatch = line.match(/^\s*import\s+(?:public\s+|weak\s+)?\"([^\"]+)\"/);
    if (importMatch?.[1]) addImport(importMatch[1]);
    const packageMatch = line.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/);
    if (packageMatch?.[1]) addImport(packageMatch[1]);
    const optionPackage = line.match(/\boption\s+(?:go_package|java_package)\s*=\s*\"([^\"]+)\"/);
    if (optionPackage?.[1]) addImport(optionPackage[1]);
  }
  return Array.from(imports);
};
