import {
  addCollectorImportEntry,
  collectorImportEntriesToSpecifiers,
  createCollectorImportEntryStore,
  createCommentAwareLineStripper,
  finalizeCollectorImportEntries,
  lineHasAny,
  shouldScanLine
} from './utils.js';

const resolveStarlarkCollectorHint = (specifier) => {
  const token = String(specifier || '').trim();
  if (!token) return null;
  if (token.startsWith('@') || token.startsWith('//') || token.startsWith(':')) {
    return {
      reasonCode: 'IMP_U_RESOLVER_GAP',
      confidence: 0.9,
      detail: 'starlark-label'
    };
  }
  return null;
};

export const collectStarlarkImportEntries = (text) => {
  const imports = createCollectorImportEntryStore();
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
    if (loadMatch?.[1]) {
      const specifier = loadMatch[1];
      addCollectorImportEntry(imports, specifier, {
        collectorHint: resolveStarlarkCollectorHint(specifier)
      });
    }
    const moduleDep = line.match(/\bbazel_dep\s*\([^)]*\bname\s*=\s*['"]([^'"]+)['"]/);
    if (moduleDep?.[1]) {
      const specifier = `@${moduleDep[1]}`;
      addCollectorImportEntry(imports, specifier, {
        collectorHint: resolveStarlarkCollectorHint(specifier)
      });
    }
    const useExtension = line.match(/\buse_extension\s*\(\s*['"]([^'"]+)['"]/);
    if (useExtension?.[1]) {
      const specifier = useExtension[1];
      addCollectorImportEntry(imports, specifier, {
        collectorHint: resolveStarlarkCollectorHint(specifier)
      });
    }
    const pathOverride = line.match(/\blocal_path_override\s*\([^)]*\bpath\s*=\s*['"]([^'"]+)['"]/);
    if (pathOverride?.[1]) addCollectorImportEntry(imports, pathOverride[1]);
  }
  return finalizeCollectorImportEntries(imports);
};

export const collectStarlarkImports = (text) => (
  collectorImportEntriesToSpecifiers(collectStarlarkImportEntries(text))
);
