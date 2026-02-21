import { lineHasAny, shouldScanLine } from './utils.js';

export const collectStarlarkImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAny(value, [
    'load',
    'bazel_dep',
    'use_extension',
    'local_path_override'
  ]);
  for (const line of lines) {
    if (!shouldScanLine(line, precheck)) continue;
    if (line.trim().startsWith('#')) continue;
    const loadMatch = line.match(/^\s*load\s*(?:\(\s*)?['"]([^'"]+)['"]/);
    if (loadMatch?.[1]) imports.add(loadMatch[1]);
    const moduleDep = line.match(/\bbazel_dep\s*\([^)]*\bname\s*=\s*['"]([^'"]+)['"]/);
    if (moduleDep?.[1]) imports.add(`@${moduleDep[1]}`);
    const useExtension = line.match(/\buse_extension\s*\(\s*['"]([^'"]+)['"]/);
    if (useExtension?.[1]) imports.add(useExtension[1]);
    const pathOverride = line.match(/\blocal_path_override\s*\([^)]*\bpath\s*=\s*['"]([^'"]+)['"]/);
    if (pathOverride?.[1]) imports.add(pathOverride[1]);
  }
  return Array.from(imports);
};
