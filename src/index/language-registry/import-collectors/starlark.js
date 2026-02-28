import {
  addCollectorImportEntry,
  collectorImportEntriesToSpecifiers,
  createCollectorImportEntryStore,
  createCommentAwareLineStripper,
  finalizeCollectorImportEntries,
  lineHasAny
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
  const source = String(text || '');
  const lines = source.split('\n');
  const stripComments = createCommentAwareLineStripper({
    markers: ['#']
  });
  const precheck = (value) => lineHasAny(value, [
    'load',
    'bazel_dep',
    'use_extension',
    'local_path_override'
  ]);
  if (!precheck(source)) return [];
  const strippedSource = lines.map((line) => stripComments(line)).join('\n');

  const loadMatches = strippedSource.matchAll(/\bload\s*(?:\(\s*)?['"]([^'"]+)['"]/g);
  for (const loadMatch of loadMatches) {
    if (!loadMatch?.[1]) continue;
    const specifier = loadMatch[1];
    addCollectorImportEntry(imports, specifier, {
      collectorHint: resolveStarlarkCollectorHint(specifier)
    });
  }

  const bazelDepCalls = strippedSource.matchAll(/\bbazel_dep\s*\(([\s\S]*?)\)/g);
  for (const bazelDepCall of bazelDepCalls) {
    const moduleDep = String(bazelDepCall?.[1] || '').match(/\bname\s*=\s*['"]([^'"]+)['"]/);
    if (!moduleDep?.[1]) continue;
    const specifier = `@${moduleDep[1]}`;
    addCollectorImportEntry(imports, specifier, {
      collectorHint: resolveStarlarkCollectorHint(specifier)
    });
  }

  const useExtensionCalls = strippedSource.matchAll(/\buse_extension\s*\(([\s\S]*?)\)/g);
  for (const useExtensionCall of useExtensionCalls) {
    const useExtension = String(useExtensionCall?.[1] || '').match(/^\s*['"]([^'"]+)['"]/);
    if (!useExtension?.[1]) continue;
    const specifier = useExtension[1];
    addCollectorImportEntry(imports, specifier, {
      collectorHint: resolveStarlarkCollectorHint(specifier)
    });
  }

  const pathOverrideCalls = strippedSource.matchAll(/\blocal_path_override\s*\(([\s\S]*?)\)/g);
  for (const pathOverrideCall of pathOverrideCalls) {
    const pathOverride = String(pathOverrideCall?.[1] || '').match(/\bpath\s*=\s*['"]([^'"]+)['"]/);
    if (pathOverride?.[1]) addCollectorImportEntry(imports, pathOverride[1]);
  }
  return finalizeCollectorImportEntries(imports);
};

export const collectStarlarkImports = (text) => (
  collectorImportEntriesToSpecifiers(collectStarlarkImportEntries(text))
);
