// Source UNVALIDATED. Preserve the established JSON preview fields while using
// the same canonical selected-file/authority explanation as effective validate.
import { getCapabilities } from '../../src/shared/capabilities.js';
import { getEnvConfig } from '../../src/shared/env/runtime.js';
import { getRuntimeCapabilityManifest } from '../../src/shared/runtime-capability-manifest.js';
import { sanitizeRuntimeReceipt } from '../../src/shared/runtime-envelope/receipt.js';
import { explainEffectiveConfiguration } from './effective.js';

export const buildConfigurationDump = async ({ repoRoot, configPath = null, env = process.env, includeCapabilities = false } = {}, dependencies = {}) => {
  const report = await (dependencies.explain || explainEffectiveConfiguration)({ repoRoot, configPath, env });
  if (!report.ok) return report;
  const envConfig = getEnvConfig(env);
  const normalizeSelector = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const modeEnv = normalizeSelector(envConfig.mcpMode);
  const modeConfig = normalizeSelector(report.userConfig?.mcp?.mode);
  const capabilities = includeCapabilities ? (dependencies.capabilities || getCapabilities)() : null;
  return sanitizeRuntimeReceipt({ ...report.preview, ...report, preview: report.preview,
    derived: { cacheRoot: report.preview.paths.cache?.selected || null, repoCacheRoot: report.preview.paths.repoCache?.selected || null,
      mcp: { mode: modeEnv || modeConfig || 'auto', modeSource: modeEnv ? 'env' : modeConfig ? 'config' : 'default',
        sdkAvailable: capabilities ? Boolean(capabilities.mcp?.sdk) : null, capabilityProbe: includeCapabilities ? 'requested' : 'not-requested' },
      ...(capabilities ? { capabilityManifest: (dependencies.manifest || getRuntimeCapabilityManifest)({ runtimeCapabilities: capabilities }) } : {}) }
  });
};
