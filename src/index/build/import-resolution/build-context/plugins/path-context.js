import path from 'node:path';
import { normalizeImportSpecifier } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';

const BAZEL_SOURCE_EXTENSIONS = new Set(['.bazel', '.bzl', '.star']);
const CONFIG_ROOT_SENTINEL_EXTENSIONS = new Set([
  '.json',
  '.jsonc',
  '.json5',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf'
]);

const normalizeImporterRel = (value) => String(value || '').replace(/\\/g, '/').trim();

const countLeadingParentSegments = (value) => {
  const segments = String(value || '').split('/').filter(Boolean);
  let count = 0;
  for (const segment of segments) {
    if (segment !== '..') break;
    count += 1;
  }
  return count;
};

const classifyBazelRootTraversal = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  const normalizedImporterRel = normalizeImporterRel(importerRel);
  const importerExt = path.posix.extname(normalizedImporterRel).toLowerCase();
  if (!BAZEL_SOURCE_EXTENSIONS.has(importerExt)) return null;
  const targetSpecifier = normalizeImportSpecifier(spec || rawSpec);
  if (!targetSpecifier.startsWith('../')) return null;
  const importerDir = path.posix.dirname(normalizedImporterRel).replace(/^\.$/, '');
  const importerDepth = importerDir ? importerDir.split('/').filter(Boolean).length : 0;
  const climbs = countLeadingParentSegments(targetSpecifier);
  if (climbs <= importerDepth) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.BAZEL_WORKSPACE_ROOT_SENTINEL,
    pluginId: 'path-context',
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'bazel_workspace_root_traversal'
    }
  };
};

const classifyConfigRootSentinel = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  const normalizedImporterRel = normalizeImporterRel(importerRel);
  const importerExt = path.posix.extname(normalizedImporterRel).toLowerCase();
  if (!CONFIG_ROOT_SENTINEL_EXTENSIONS.has(importerExt)) return null;
  const targetSpecifier = String(rawSpec || spec || '').trim();
  if (targetSpecifier !== '/') return null;
  return {
    reasonCode: IMPORT_REASON_CODES.CONFIG_ROOT_SENTINEL,
    pluginId: 'path-context',
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'config_root_sentinel'
    }
  };
};

export const createPathContextPlugin = () => Object.freeze({
  id: 'path-context',
  priority: 12,
  fingerprint: 'v1',
  classify(input = {}) {
    return classifyBazelRootTraversal(input)
      || classifyConfigRootSentinel(input);
  }
});
