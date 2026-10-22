import path from 'node:path';
import { loadUserConfig, getAutoPolicy } from '../dict-utils/config.js';
import { createRuntimePreview } from '../../src/shared/runtime-envelope/preview.js';
import { sanitizeRuntimeReceipt } from '../../src/shared/runtime-envelope/receipt.js';
import { resolveCurrentProcessRuntimeEnvelope } from '../../src/shared/runtime-envelope/resolve-current-process-envelope.js';

/** Canonical loader/preview projection. Does not probe providers or install assets. */
export const explainEffectiveConfiguration = async ({ repoRoot, configPath = null, env = process.env } = {}) => {
  let configSources = null;
  try {
    const userConfig = loadUserConfig(repoRoot, { env, configPath, onSources: value => { configSources = value; } });
    const policy = await getAutoPolicy(repoRoot, userConfig);
    const preview = await createRuntimePreview({ repoRoot, userConfig, policy, configSources,
      envelope: resolveCurrentProcessRuntimeEnvelope({ userConfig, autoPolicy: policy }) });
    return sanitizeRuntimeReceipt({
      schemaVersion: 1, kind: 'effective-configuration', ok: true,
      repoRoot, configPath: configPath ? path.resolve(configPath) : path.join(repoRoot, '.pairofcleats.json'),
      validation: { schema: 'accepted', effective: 'accepted', runtime: 'not-probed', artifacts: 'not-probed' },
      configSources, userConfig, preview,
      ignored: (configSources?.discardedAuthorityPaths || []).map(field => ({
        path: field, reason: 'repository-owned-execution-or-storage-authority-discarded',
        nextAction: 'Review user-owned trusted policy, or explicitly review repository trust.'
      })),
      precedence: ['runtime defaults', 'authority-filtered repository configuration', 'user-owned trusted configuration', 'supported launch environment overrides', 'explicit CLI options'],
      readiness: 'Configuration acceptance does not establish executable, protocol, model or index readiness.'
    });
  } catch (error) {
    return sanitizeRuntimeReceipt({ schemaVersion: 1, kind: 'effective-configuration', ok: false, repoRoot,
      configSources, validation: { schema: 'rejected-or-unreadable', effective: 'rejected', runtime: 'not-probed', artifacts: 'not-probed' },
      errors: error.errors || [{ code: error.code || 'ERR_EFFECTIVE_CONFIG', message: error.message }],
      errorCode: error.code || 'ERR_EFFECTIVE_CONFIG' });
  }
};

export const formatEffectiveConfiguration = report => {
  const lines = [`Effective configuration: ${report.ok ? 'accepted' : 'rejected'}; runtime/artifacts not probed`, `- repo: ${report.repoRoot}`];
  for (const source of report.configSources?.files || []) lines.push(`- source: ${source.source}: ${source.path} (${source.exists ? 'read' : 'absent'})`);
  if (report.configSources) lines.push(`- repository trust: ${report.configSources.repoTrusted ? 'trusted' : 'untrusted'}; trusted merge: ${report.configSources.trustedMerge ? 'applied' : 'none'}`);
  for (const ignored of report.ignored || []) lines.push(`- ignored: ${ignored.path}: ${ignored.reason}. ${ignored.nextAction}`);
  if (report.preview?.embeddings) lines.push(`- selected model: ${report.preview.embeddings.selectedModel} (${report.preview.embeddings.modelSource}); observed runtime: unknown`);
  for (const error of report.errors || []) lines.push(`- ${error.code || 'config'}: ${error.message}`);
  if (report.readiness) lines.push(report.readiness);
  return lines.join('\n');
};
