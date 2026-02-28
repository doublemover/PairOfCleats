import { normalizeImportToken } from '../simple-relations.js';
import {
  addCollectorImportEntry,
  collectorImportEntriesToSpecifiers,
  createCollectorImportEntryStore,
  createCommentAwareLineStripper,
  finalizeCollectorImportEntries,
  lineHasAny
} from './utils.js';

const NIX_IMPORT_CALL_RX = /\b(?:import|callPackage)\s+("([^"\\]|\\.)+"|'([^'\\]|\\.)+'|[^\s;(){}\]]+)/g;
const NIX_IMPORTS_BLOCK_REL_PATH_RX = /(?:^|[\s(])(\.\.?\/[A-Za-z0-9_.\/-]+(?:\.nix)?)(?=$|[\s)])/g;

const resolveNixCollectorHint = (specifier, { source = null } = {}) => {
  const token = String(specifier || '').trim();
  if (!token) return null;
  const isFlakeInputRef = token.startsWith('github:')
    || token.startsWith('git+')
    || token.startsWith('path:')
    || token.startsWith('flake:')
    || token.startsWith('<');
  if (source === 'getFlake' || source === 'flakeInput' || isFlakeInputRef) {
    return {
      reasonCode: 'IMP_U_RESOLVER_GAP',
      confidence: 0.86,
      detail: source || 'nix-flake-ref'
    };
  }
  return null;
};

export const collectNixImportEntries = (text) => {
  const imports = createCollectorImportEntryStore();
  const source = String(text || '');
  const lines = source.split('\n');
  const stripComments = createCommentAwareLineStripper({
    markers: ['#']
  });
  const precheck = (value) => lineHasAny(value, [
    'import',
    'callPackage',
    'imports',
    'inputs.',
    'getFlake',
    '.nix'
  ]);
  if (!precheck(source)) return [];
  const addImport = (value) => {
    const cleaned = normalizeImportToken(value);
    addCollectorImportEntry(imports, cleaned);
  };
  const strippedSource = lines.map((line) => stripComments(line)).join('\n');
  const importMatches = strippedSource.matchAll(NIX_IMPORT_CALL_RX);
  for (const match of importMatches) {
    if (match?.[1]) addImport(match[1]);
  }

  const getFlakeMatches = strippedSource.matchAll(/\bbuiltins\.getFlake\s+([^\s;]+)/g);
  for (const getFlakeMatch of getFlakeMatches) {
    if (!getFlakeMatch?.[1]) continue;
    const cleaned = normalizeImportToken(getFlakeMatch[1]);
    addCollectorImportEntry(imports, cleaned, {
      collectorHint: resolveNixCollectorHint(cleaned, { source: 'getFlake' })
    });
  }

  const flakeInputMatches = strippedSource.matchAll(
    /\binputs\.[A-Za-z_][A-Za-z0-9_-]*\.(?:url|path|follows)\s*=\s*([^\s;]+)/g
  );
  for (const flakeInputMatch of flakeInputMatches) {
    if (!flakeInputMatch?.[1]) continue;
    const cleaned = normalizeImportToken(flakeInputMatch[1]);
    addCollectorImportEntry(imports, cleaned, {
      collectorHint: resolveNixCollectorHint(cleaned, { source: 'flakeInput' })
    });
  }

  const importsArrayMatches = strippedSource.matchAll(/\bimports\s*=\s*\[([\s\S]*?)\]/g);
  for (const importsArrayMatch of importsArrayMatches) {
    if (!importsArrayMatch?.[1]) continue;
    const pathMatches = importsArrayMatch[1].matchAll(NIX_IMPORTS_BLOCK_REL_PATH_RX);
    for (const pathMatch of pathMatches) {
      if (pathMatch?.[1]) addCollectorImportEntry(imports, pathMatch[1]);
    }
  }
  return finalizeCollectorImportEntries(imports);
};

export const collectNixImports = (text) => (
  collectorImportEntriesToSpecifiers(collectNixImportEntries(text))
);
