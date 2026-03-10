import path from 'node:path';
import { normalizeImportSpecifier } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';

const BAZEL_SOURCE_EXTENSIONS = new Set(['.bazel', '.bzl', '.star']);
const CONFIG_ROOT_SENTINEL_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.json',
  '.jsonc',
  '.json5',
  '.nix',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf'
]);
const CONFIG_GLOB_PATTERN_RX = /[*?[\]{}]/;
const FIXTURE_PATH_PARTS = Object.freeze([
  '/test/',
  '/tests/',
  '/__tests__/',
  '/fixture/',
  '/fixtures/',
  '/__fixtures__/',
  '/example/',
  '/examples/',
  '/manual/',
  '/sandbox/',
  '/demo/'
]);
const OPTIONAL_DEPENDENCY_SPECS = new Set([
  'fsevents',
  '@napi-rs/canvas',
  'canvas'
]);

const normalizeImporterRel = (value) => String(value || '').replace(/\\/g, '/').trim();
const isFixtureSurfacePath = (value) => {
  const normalized = `/${normalizeImporterRel(value).replace(/^\/+|\/+$/g, '')}/`.toLowerCase();
  if (normalized === '//') return false;
  return FIXTURE_PATH_PARTS.some((part) => normalized.includes(part));
};

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
  if (climbs < importerDepth) return null;
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
  if (targetSpecifier === '/') {
    return {
      reasonCode: IMPORT_REASON_CODES.CONFIG_ROOT_SENTINEL,
      pluginId: 'path-context',
      match: {
        matched: true,
        source: 'plugin',
        matchType: 'config_root_sentinel'
      }
    };
  }
  if (targetSpecifier.startsWith('/')) {
    return {
      reasonCode: IMPORT_REASON_CODES.CONFIG_ROOT_ANCHORED_PATH,
      pluginId: 'path-context',
      match: {
        matched: true,
        source: 'plugin',
        matchType: 'config_root_anchored_path'
      }
    };
  }
  if (CONFIG_GLOB_PATTERN_RX.test(targetSpecifier)) {
    return {
      reasonCode: IMPORT_REASON_CODES.CONFIG_GLOB_PATTERN,
      pluginId: 'path-context',
      match: {
        matched: true,
        source: 'plugin',
        matchType: 'config_glob_pattern'
      }
    };
  }
  return null;
};

const classifyConfigRootedSpecifier = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  const normalizedImporterRel = normalizeImporterRel(importerRel);
  const importerExt = path.posix.extname(normalizedImporterRel).toLowerCase();
  if (!CONFIG_ROOT_SENTINEL_EXTENSIONS.has(importerExt)) return null;
  const normalizedSpec = normalizeImportSpecifier(spec || rawSpec);
  if (!normalizedSpec || normalizedSpec === '/' || !normalizedSpec.startsWith('/')) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.CONFIG_ROOT_ANCHORED_PATH,
    pluginId: 'path-context',
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'config_root_anchored_path'
    }
  };
};

const classifyFixtureReference = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  if (!isFixtureSurfacePath(importerRel)) return null;
  const targetSpecifier = String(rawSpec || spec || '').trim();
  if (!targetSpecifier) return null;
  if (
    targetSpecifier.startsWith('/')
    || targetSpecifier.startsWith('./')
    || targetSpecifier.startsWith('../')
  ) {
    return {
      reasonCode: IMPORT_REASON_CODES.FIXTURE_REFERENCE,
      pluginId: 'path-context',
      match: {
        matched: true,
        source: 'plugin',
        matchType: 'fixture_reference'
      }
    };
  }
  return null;
};

const classifyOptionalDependency = ({ spec = '', rawSpec = '' } = {}) => {
  const targetSpecifier = normalizeImportSpecifier(spec || rawSpec);
  if (!OPTIONAL_DEPENDENCY_SPECS.has(targetSpecifier)) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.OPTIONAL_DEPENDENCY,
    pluginId: 'path-context',
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'optional_dependency'
    }
  };
};

export const createPathContextPlugin = () => Object.freeze({
  id: 'path-context',
  priority: 12,
  fingerprint: 'v3',
  classify(input = {}) {
    return classifyBazelRootTraversal(input)
      || classifyOptionalDependency(input)
      || classifyFixtureReference(input)
      || classifyConfigRootSentinel(input)
      || classifyConfigRootedSpecifier(input);
  }
});
