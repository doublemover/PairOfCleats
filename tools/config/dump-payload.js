// Preserve the canonical selected-file/authority explanation. Capability-only
// dependency graphs are linked only when the caller explicitly requests them.
import { getEnvConfig } from '../../src/shared/env/runtime.js';
import { sanitizeRuntimeReceipt } from '../../src/shared/runtime-envelope/receipt.js';
import { explainEffectiveConfiguration } from './effective.js';

export const buildConfigurationDump = async ({ repoRoot, configPath = null, env = process.env, includeCapabilities = false } = {}, dependencies = {}) => {
  const report = await (dependencies.explain || explainEffectiveConfiguration)({ repoRoot, configPath, env });
  if (!report.ok) return report;
  const envConfig = getEnvConfig(env);
  const normalizeSelector = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const modeEnv = normalizeSelector(envConfig.mcpMode);
  const modeConfig = normalizeSelector(report.userConfig?.mcp?.mode);
  let capabilities = null, capabilityManifest = null;
  if (includeCapabilities) {
    const probe = dependencies.capabilities || (await import('../../src/shared/capabilities.js')).getCapabilities;
    capabilities = probe();
    if (capabilities) {
      const manifest = dependencies.manifest || (await import('../../src/shared/runtime-capability-manifest.js')).getRuntimeCapabilityManifest;
      capabilityManifest = manifest({ runtimeCapabilities: capabilities });
    }
  }
  return sanitizeRuntimeReceipt({ ...report.preview, ...report, preview: report.preview,
    derived: { cacheRoot: report.preview.paths.cache?.selected || null, repoCacheRoot: report.preview.paths.repoCache?.selected || null,
      mcp: { mode: modeEnv || modeConfig || 'auto', modeSource: modeEnv ? 'env' : modeConfig ? 'config' : 'default',
        sdkAvailable: capabilities ? Boolean(capabilities.mcp?.sdk) : null, capabilityProbe: includeCapabilities ? 'requested' : 'not-requested' },
      ...(capabilities ? { capabilityManifest } : {}) }
  });
};
