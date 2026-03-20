import path from 'node:path';
import { normalizeImportSpecifier } from '../../path-utils.js';
import { IMPORT_REASON_CODES } from '../../reason-codes.js';
import { IMPORT_RESOLUTION_TRACE_STAGES } from '../../trace-model.js';

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
  '/testing/',
  '/__tests__/',
  '/spec/',
  '/specs/',
  '/fixture/',
  '/fixtures/',
  '/__fixtures__/',
  '/e2e/',
  '/benchmark/',
  '/benchmarks/',
  '/example/',
  '/examples/',
  '/manual/',
  '/sandbox/',
  '/demo/',
  '/.template.config/',
  '/vendor/',
  '/vendors/',
  '/third_party/'
]);
const BUILD_SCRIPT_PATH_PARTS = Object.freeze([
  '/bin/',
  '/script/',
  '/scripts/',
  '/tool/',
  '/tools/'
]);
const BUILD_OUTPUT_PATH_PARTS = Object.freeze([
  '/dist/',
  '/build/',
  '/out/',
  '/generated/',
  '/coverage/',
  '/.next/',
  '/_framework/'
]);
const WEB_RUNTIME_SURFACE_PATH_PARTS = Object.freeze([
  '/wwwroot/',
  '/public/'
]);
const TS_EMIT_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JS_EMIT_OUTPUT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.d.ts', '.d.mts', '.d.cts']);
const DART_PACKAGE_ROOT_PATH_PARTS = Object.freeze([
  '/lib/'
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
const isBuildScriptSurfacePath = (value) => {
  const normalized = `/${normalizeImporterRel(value).replace(/^\/+|\/+$/g, '')}/`.toLowerCase();
  if (normalized === '//') return false;
  return BUILD_SCRIPT_PATH_PARTS.some((part) => normalized.includes(part));
};
const isWebRuntimeSurfacePath = (value) => {
  const normalized = `/${normalizeImporterRel(value).replace(/^\/+|\/+$/g, '')}/`.toLowerCase();
  if (normalized === '//') return false;
  return WEB_RUNTIME_SURFACE_PATH_PARTS.some((part) => normalized.includes(part));
};
const isDartPackageRootSurfacePath = (value) => {
  const normalized = `/${normalizeImporterRel(value).replace(/^\/+|\/+$/g, '')}/`.toLowerCase();
  if (normalized === '//') return false;
  return DART_PACKAGE_ROOT_PATH_PARTS.some((part) => normalized.includes(part));
};
const looksLikeBuildOutputSpecifier = (value) => {
  const normalized = normalizeImportSpecifier(value).toLowerCase();
  if (!normalized) return false;
  return BUILD_OUTPUT_PATH_PARTS.some((part) => normalized.includes(part));
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
    adapter: 'path-context',
    traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
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
      adapter: 'path-context',
      traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
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
      adapter: 'path-context',
      traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
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
    adapter: 'path-context',
    traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
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
    || targetSpecifier.startsWith('.')
  ) {
    return {
      reasonCode: IMPORT_REASON_CODES.FIXTURE_REFERENCE,
      pluginId: 'path-context',
      adapter: 'path-context',
      traceStage: IMPORT_RESOLUTION_TRACE_STAGES.CLASSIFY,
      match: {
        matched: true,
        source: 'plugin',
        matchType: 'fixture_reference'
      }
    };
  }
  return null;
};

const classifyBuildOutputReference = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  if (!isBuildScriptSurfacePath(importerRel)) return null;
  const targetSpecifier = String(rawSpec || spec || '').trim();
  if (!targetSpecifier) return null;
  if (!looksLikeBuildOutputSpecifier(targetSpecifier)) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING,
    pluginId: 'path-context',
    adapter: 'path-context',
    traceStage: IMPORT_RESOLUTION_TRACE_STAGES.GENERATED_ARTIFACT_INTERPRETATION,
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'build_output_script_reference'
    }
  };
};

const classifyBuildScriptTypeScriptEmitReference = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  if (!isBuildScriptSurfacePath(importerRel)) return null;
  const importerExt = path.posix.extname(normalizeImporterRel(importerRel)).toLowerCase();
  if (!TS_EMIT_SOURCE_EXTENSIONS.has(importerExt)) return null;
  const normalizedSpec = normalizeImportSpecifier(spec || rawSpec);
  if (!normalizedSpec || !normalizedSpec.startsWith('.')) return null;
  const specExt = path.posix.extname(normalizedSpec).toLowerCase();
  if (!JS_EMIT_OUTPUT_EXTENSIONS.has(specExt)) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING,
    pluginId: 'path-context',
    adapter: 'path-context',
    traceStage: IMPORT_RESOLUTION_TRACE_STAGES.GENERATED_ARTIFACT_INTERPRETATION,
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'build_script_typescript_emit_reference'
    }
  };
};

const classifyBuildRuntimeRootReference = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  if (!isBuildScriptSurfacePath(importerRel)) return null;
  const targetSpecifier = String(rawSpec || spec || '').trim();
  if (!targetSpecifier || !targetSpecifier.startsWith('/')) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.RESOLVER_GAP,
    pluginId: 'path-context',
    adapter: 'path-context',
    traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'build_runtime_root_reference'
    }
  };
};

const classifyWebRuntimeBootstrapReference = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  if (!isWebRuntimeSurfacePath(importerRel)) return null;
  const targetSpecifier = String(rawSpec || spec || '').trim();
  if (!targetSpecifier) return null;
  const normalizedSpecifier = normalizeImportSpecifier(targetSpecifier).toLowerCase();
  const bootstrapAsset = normalizedSpecifier === './bundle.js'
    || normalizedSpecifier === './main.js'
    || normalizedSpecifier.startsWith('./assets/')
    || normalizedSpecifier.startsWith('./static/')
    || normalizedSpecifier.startsWith('./_framework/')
    || normalizedSpecifier.startsWith('_framework/');
  if (!looksLikeBuildOutputSpecifier(targetSpecifier) && !bootstrapAsset) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING,
    pluginId: 'path-context',
    adapter: 'path-context',
    traceStage: IMPORT_RESOLUTION_TRACE_STAGES.GENERATED_ARTIFACT_INTERPRETATION,
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'web_runtime_bootstrap_reference'
    }
  };
};

const classifyDartPackageRootReference = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
  if (!isDartPackageRootSurfacePath(importerRel)) return null;
  const importerExt = path.posix.extname(normalizeImporterRel(importerRel)).toLowerCase();
  if (importerExt !== '.dart') return null;
  const targetSpecifier = String(rawSpec || spec || '').trim();
  if (!targetSpecifier.startsWith('/')) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.RESOLVER_GAP,
    pluginId: 'path-context',
    adapter: 'path-context',
    traceStage: IMPORT_RESOLUTION_TRACE_STAGES.WORKSPACE_ANCHORING,
    match: {
      matched: true,
      source: 'plugin',
      matchType: 'dart_package_root_reference'
    }
  };
};

const classifyOptionalDependency = ({ spec = '', rawSpec = '' } = {}) => {
  const targetSpecifier = normalizeImportSpecifier(spec || rawSpec);
  if (!OPTIONAL_DEPENDENCY_SPECS.has(targetSpecifier)) return null;
  return {
    reasonCode: IMPORT_REASON_CODES.OPTIONAL_DEPENDENCY,
    pluginId: 'path-context',
    adapter: 'path-context',
    traceStage: IMPORT_RESOLUTION_TRACE_STAGES.CLASSIFY,
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
  fingerprint: 'v5',
  classify(input = {}) {
    return classifyBazelRootTraversal(input)
      || classifyOptionalDependency(input)
      || classifyDartPackageRootReference(input)
      || classifyBuildRuntimeRootReference(input)
      || classifyWebRuntimeBootstrapReference(input)
      || classifyBuildScriptTypeScriptEmitReference(input)
      || classifyBuildOutputReference(input)
      || classifyFixtureReference(input)
      || classifyConfigRootSentinel(input)
      || classifyConfigRootedSpecifier(input);
  }
});
