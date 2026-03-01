import path from 'node:path';
import { normalizeImportSpecifier } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';

const REMOTE_NIX_REF_PREFIXES = Object.freeze([
  'flake:',
  'github:',
  'gitlab:',
  'sourcehut:',
  'path:',
  'tarball:',
  'git+',
  'http://',
  'https://'
]);

const isNixImporter = (importerRel = '') => (
  path.posix.extname(String(importerRel || '')).toLowerCase() === '.nix'
);

const isNixFlakeResolverGap = (specifier = '') => {
  const normalized = normalizeImportSpecifier(specifier).trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (normalized.startsWith('<') && normalized.endsWith('>')) return true;
  if (normalized.startsWith('nixpkgs/')) return true;
  if (REMOTE_NIX_REF_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  return false;
};

export const createNixFlakePlugin = () => {
  const classify = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
    if (!isNixImporter(importerRel)) return null;
    const targetSpecifier = spec || rawSpec;
    if (!isNixFlakeResolverGap(targetSpecifier)) return null;
    return {
      reasonCode: IMPORT_REASON_CODES.RESOLVER_GAP,
      pluginId: 'nix-flake',
      match: {
        matched: true,
        source: 'plugin',
        matchType: 'nix_flake_reference'
      }
    };
  };

  return Object.freeze({
    id: 'nix-flake',
    priority: 15,
    fingerprint: 'v1',
    classify
  });
};
