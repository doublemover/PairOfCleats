import {
  addCollectorImport,
  createCommentAwareLineStripper,
  lineHasAny,
  shouldScanLine
} from './utils.js';

export const collectStarlarkImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const stripComments = createCommentAwareLineStripper({
    markers: ['#']
  });
  const precheck = (value) => lineHasAny(value, [
    'load',
    'bazel_dep',
    'use_extension',
    'local_path_override'
  ]);
  for (const rawLine of lines) {
    if (!shouldScanLine(rawLine, precheck)) continue;
    const line = stripComments(rawLine);
    if (!line.trim()) continue;
    if (line.trim().startsWith('#')) continue;
    const loadMatch = line.match(/^\s*load\s*(?:\(\s*)?['"]([^'"]+)['"]/);
    if (loadMatch?.[1]) addCollectorImport(imports, loadMatch[1]);
    const moduleDep = line.match(/\bbazel_dep\s*\([^)]*\bname\s*=\s*['"]([^'"]+)['"]/);
    if (moduleDep?.[1]) addCollectorImport(imports, `@${moduleDep[1]}`);
    const useExtension = line.match(/\buse_extension\s*\(\s*['"]([^'"]+)['"]/);
    if (useExtension?.[1]) addCollectorImport(imports, useExtension[1]);
    const pathOverride = line.match(/\blocal_path_override\s*\([^)]*\bpath\s*=\s*['"]([^'"]+)['"]/);
    if (pathOverride?.[1]) addCollectorImport(imports, pathOverride[1]);
  }
  return Array.from(imports);
};
