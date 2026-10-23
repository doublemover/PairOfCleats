import path from 'node:path';
import { loadUserConfig, getAutoPolicy } from '../dict-utils/config.js';
import { createRuntimePreview } from '../../src/shared/runtime-envelope/preview.js';
import { sanitizeRuntimeReceipt } from '../../src/shared/runtime-envelope/receipt.js';
import { resolveCurrentProcessRuntimeEnvelope } from '../../src/shared/runtime-envelope/resolve-current-process-envelope.js';
import { normalizeEmbeddingProvider } from '../../src/shared/onnx-embeddings/config.js';
import { getOperationalGuardrailDiagnostic, resolveOperationalGuardrails } from '../../src/retrieval/operational-guardrails.js';

/** Canonical loader/preview projection. Does not probe providers or install assets. */
export const explainEffectiveConfiguration = async ({ repoRoot, configPath = null, env = process.env } = {}) => {
  let configSources = null;
  let schemaState = 'rejected-or-unreadable';
  try {
    const userConfig = loadUserConfig(repoRoot, { env, configPath, onSources: value => { configSources = value; } });
    schemaState = 'accepted';
    resolveOperationalGuardrails({ userConfig });
    const policy = await getAutoPolicy(repoRoot, userConfig);
    const preview = await createRuntimePreview({ repoRoot, userConfig, policy, configSources, env,
      envelope: resolveCurrentProcessRuntimeEnvelope({ userConfig, autoPolicy: policy, env }) });
    let provider;
    try { provider = normalizeEmbeddingProvider(userConfig.indexing?.embeddings?.provider, { strict: true }); }
    catch {
      throw Object.assign(new Error('Unsupported embedding provider selection.'), { code: 'ERR_EFFECTIVE_PROVIDER',
        errors: [{ code: 'unsupported-provider', path: '/indexing/embeddings/provider', message: 'Select a provider accepted by the canonical embedding owner.' }] });
    }
    return sanitizeRuntimeReceipt({
      schemaVersion: 1, kind: 'effective-configuration', ok: true,
      repoRoot, configPath: configPath ? path.resolve(configPath) : path.join(repoRoot, '.pairofcleats.json'),
      validation: { schema: 'accepted', effective: 'accepted', runtime: 'not-probed', artifacts: 'not-probed' },
      configSources, userConfig, policy, preview,
      selected: { quality: policy.quality,
        embeddingProvider: { value: provider, source: userConfig.indexing?.embeddings?.provider ? 'effective-config.indexing.embeddings.provider' : 'canonical-provider-default' },
        backend: { state: 'selection-deferred', reason: 'Search CLI options, admitted generation and backend policy determine the actual backend; artifacts were not probed.' } },
      ignored: (configSources?.discardedAuthorityPaths || []).map(field => ({
        path: field, reason: 'repository-owned-execution-or-storage-authority-discarded',
        nextAction: 'Review user-owned trusted policy, or explicitly review repository trust.'
      })),
      precedence: ['runtime defaults', 'authority-filtered repository configuration', 'user-owned trusted configuration', 'supported launch environment overrides', 'explicit CLI options'],
      readiness: 'Configuration acceptance does not establish executable, protocol, model or index readiness.'
    });
  } catch (error) {
    const guardrail = getOperationalGuardrailDiagnostic(error);
    return sanitizeRuntimeReceipt({ schemaVersion: 1, kind: 'effective-configuration', ok: false, repoRoot,
      configSources, validation: { schema: schemaState, effective: 'rejected', runtime: 'not-probed', artifacts: 'not-probed' },
      errors: guardrail ? [guardrail] : error.errors || [{ code: error.code || 'ERR_EFFECTIVE_CONFIG', message: error.message }],
      errorCode: guardrail?.code || error.code || 'ERR_EFFECTIVE_CONFIG' });
  }
};

export const formatEffectiveConfiguration = report => {
  const lines = [`Effective configuration: ${report.ok ? 'accepted' : 'rejected'}; runtime/artifacts not probed`, `- repo: ${report.repoRoot}`];
  for (const source of report.configSources?.files || []) lines.push(`- source: ${source.source}: ${source.path} (${source.exists ? 'read' : 'absent'})`);
  if (report.configSources) lines.push(`- repository trust: ${report.configSources.repoTrusted ? 'trusted' : 'untrusted'}; trusted merge: ${report.configSources.trustedMerge ? 'applied' : 'none'}`);
  for (const ignored of report.ignored || []) lines.push(`- ignored: ${ignored.path}: ${ignored.reason}. ${ignored.nextAction}`);
  if (report.preview?.embeddings) lines.push(`- selected model: ${report.preview.embeddings.selectedModel} (${report.preview.embeddings.modelSource}); observed runtime: unknown`);
  if (report.selected?.quality) lines.push(`- quality: ${report.selected.quality.value} (${report.selected.quality.source})`);
  if (report.selected?.embeddingProvider) lines.push(`- selected embedding provider: ${report.selected.embeddingProvider.value} (${report.selected.embeddingProvider.source}); runtime not probed`);
  if (report.selected?.backend) lines.push(`- backend: ${report.selected.backend.state}; ${report.selected.backend.reason}`);
  for (const name of ['threads', 'fileConcurrency', 'ioConcurrency', 'embeddingConcurrency']) {
    const choice = report.preview?.concurrency?.[name];
    if (choice) lines.push(`- ${name}: ${choice.value} (${choice.source}${choice.detail ? `; ${choice.detail}` : ''})`);
  }
  for (const error of report.errors || []) lines.push(`- ${error.code || 'config'}: ${error.message}`);
  if (report.readiness) lines.push(report.readiness);
  return lines.join('\n');
};
