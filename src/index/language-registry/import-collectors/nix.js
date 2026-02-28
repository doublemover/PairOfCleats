import { normalizeImportToken } from '../simple-relations.js';
import {
  addCollectorImportEntry,
  collectorImportEntriesToSpecifiers,
  createCollectorImportEntryStore,
  createCommentAwareLineStripper,
  finalizeCollectorImportEntries,
  lineHasAny,
  shouldScanLine
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
  const lines = String(text || '').split('\n');
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
  const addImport = (value) => {
    const cleaned = normalizeImportToken(value);
    addCollectorImportEntry(imports, cleaned);
  };
  for (const rawLine of lines) {
    if (!shouldScanLine(rawLine, precheck)) continue;
    const line = stripComments(rawLine);
    if (!line.trim()) continue;
    const importMatches = line.matchAll(NIX_IMPORT_CALL_RX);
    for (const match of importMatches) {
      if (match?.[1]) addImport(match[1]);
    }
    const getFlakeMatch = line.match(/\bbuiltins\.getFlake\s+([^\s;]+)/);
    if (getFlakeMatch?.[1]) {
      const cleaned = normalizeImportToken(getFlakeMatch[1]);
      addCollectorImportEntry(imports, cleaned, {
        collectorHint: resolveNixCollectorHint(cleaned, { source: 'getFlake' })
      });
    }
    const flakeInputMatch = line.match(/\binputs\.[A-Za-z_][A-Za-z0-9_-]*\.(?:url|path|follows)\s*=\s*([^\s;]+)/);
    if (flakeInputMatch?.[1]) {
      const cleaned = normalizeImportToken(flakeInputMatch[1]);
      addCollectorImportEntry(imports, cleaned, {
        collectorHint: resolveNixCollectorHint(cleaned, { source: 'flakeInput' })
      });
    }
    const importsArrayMatch = line.match(/\bimports\s*=\s*\[([^\]]+)\]/);
    if (importsArrayMatch?.[1]) {
      const pathMatches = importsArrayMatch[1].matchAll(NIX_IMPORTS_BLOCK_REL_PATH_RX);
      for (const pathMatch of pathMatches) {
        if (pathMatch?.[1]) addCollectorImportEntry(imports, pathMatch[1]);
      }
    }
  }
  return finalizeCollectorImportEntries(imports);
};

export const collectNixImports = (text) => (
  collectorImportEntriesToSpecifiers(collectNixImportEntries(text))
);
