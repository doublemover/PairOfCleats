import { sortStrings } from '../path-utils.js';
import { IMPORT_REASON_CODES } from '../reason-codes.js';
import { createExpectedArtifactsIndex } from '../expected-artifacts-index.js';
import { createBazelLabelPlugin } from './plugins/bazel-label.js';
import { createPathContextPlugin } from './plugins/path-context.js';
import { createGeneratedArtifactsPlugin } from './plugins/generated-artifacts.js';
import { createNixFlakePlugin } from './plugins/nix-flake.js';
import { createTypeScriptEmitPlugin } from './plugins/typescript-emit.js';

const normalizePluginConfig = (resolverPlugins) => (
  resolverPlugins && typeof resolverPlugins === 'object'
    ? resolverPlugins
    : {}
);

const isEnabled = (value, defaultValue = true) => {
  if (typeof value === 'boolean') return value;
  return defaultValue;
};

const stablePluginComparator = (a, b) => {
  const priorityDelta = (a?.priority || 0) - (b?.priority || 0);
  if (priorityDelta !== 0) return priorityDelta;
  return sortStrings(String(a?.id || ''), String(b?.id || ''));
};

const buildPluginFingerprint = (plugins) => (
  plugins
    .map((plugin) => `${plugin.id}:${plugin.priority}:${plugin.fingerprint || 'none'}`)
    .sort(sortStrings)
    .join('|')
);

const buildGeneratedPolicyFingerprint = (generatedPolicy) => {
  if (!generatedPolicy || typeof generatedPolicy !== 'object') return 'policy=default';
  const includePatterns = Array.isArray(generatedPolicy.includePatterns)
    ? generatedPolicy.includePatterns.slice().sort(sortStrings)
    : [];
  const excludePatterns = Array.isArray(generatedPolicy.excludePatterns)
    ? generatedPolicy.excludePatterns.slice().sort(sortStrings)
    : [];
  return JSON.stringify({
    includePatterns,
    excludePatterns
  });
};

const resolveGeneratedMatchForResult = (result) => {
  if (result?.reasonCode !== IMPORT_REASON_CODES.GENERATED_EXPECTED_MISSING) return null;
  return result?.match || null;
};

/**
 * Build deterministic per-repo build-context classification plugins.
 */
export const createImportBuildContext = ({
  entries = [],
  resolverPlugins = null,
  rootAbs = '',
  fsMemo = null,
  generatedPolicy = null
} = {}) => {
  const normalizedConfig = normalizePluginConfig(resolverPlugins);
  const buildContextConfig = normalizedConfig.buildContext
    && typeof normalizedConfig.buildContext === 'object'
    ? normalizedConfig.buildContext
    : normalizedConfig;
  const expectedArtifactsIndex = createExpectedArtifactsIndex({ entries });
  const plugins = [];

  if (isEnabled(buildContextConfig?.bazelLabels, true)) {
    plugins.push(createBazelLabelPlugin());
  }

  if (isEnabled(buildContextConfig?.pathContext, true)) {
    plugins.push(createPathContextPlugin());
  }

  if (isEnabled(buildContextConfig?.nixFlakeReferences, true)) {
    plugins.push(createNixFlakePlugin());
  }

  if (isEnabled(buildContextConfig?.typescriptEmit, true)) {
    plugins.push(createTypeScriptEmitPlugin({
      entries,
      rootAbs,
      fsMemo
    }));
  }

  if (isEnabled(buildContextConfig?.generatedArtifacts, true)) {
    plugins.push(createGeneratedArtifactsPlugin({
      expectedArtifactsIndex,
      config: buildContextConfig.generatedArtifactsConfig || normalizedConfig.generatedArtifactsConfig || null,
      generatedPolicy
    }));
  }

  plugins.sort(stablePluginComparator);
  const fingerprint = `build-context-v4|${buildPluginFingerprint(plugins)}|${buildGeneratedPolicyFingerprint(generatedPolicy)}`;

  const classifyUnresolved = ({ importerRel = '', spec = '', rawSpec = '' } = {}) => {
    for (const plugin of plugins) {
      if (!plugin || typeof plugin.classify !== 'function') continue;
      const result = plugin.classify({ importerRel, spec, rawSpec });
      if (!result || typeof result !== 'object') continue;
      if (!result.reasonCode) continue;
      return {
        reasonCode: result.reasonCode,
        pluginId: result.pluginId || plugin.id || null,
        generatedMatch: resolveGeneratedMatchForResult(result)
      };
    }
    return null;
  };

  const resolveGeneratedExpectation = ({ importer = '', specifier = '' } = {}) => {
    const classification = classifyUnresolved({
      importerRel: importer,
      spec: specifier,
      rawSpec: specifier
    });
    return classification?.generatedMatch || null;
  };

  return Object.freeze({
    version: 'build-context-v4',
    fingerprint,
    plugins: plugins.map((plugin) => ({
      id: plugin.id,
      priority: plugin.priority
    })),
    expectedArtifactsIndex,
    classifyUnresolved,
    resolveGeneratedExpectation
  });
};
