/** Shared enablement only; provider/model/default ownership stays with its resolver. */
export const resolveEmbeddingIntent = ({
  argv = {}, embeddingsConfig = {}, envConfig = {}, policyEnabled = null, execution = 'build'
} = {}) => {
  const configured = String(embeddingsConfig.mode || 'auto').trim().toLowerCase();
  const normalizedEmbeddingMode = ['auto', 'inline', 'service', 'stub', 'off'].includes(configured)
    ? configured : 'auto';
  const environment = String(envConfig.embeddings || '').trim().toLowerCase();
  const envOff = ['off', 'false', '0', 'disabled', 'none'].includes(environment);
  const stubRequested = argv['stub-embeddings'] === true || environment === 'stub';
  const explicit = stubRequested || !['auto', 'off'].includes(normalizedEmbeddingMode);
  let reason = 'default';
  let mode = normalizedEmbeddingMode;
  if (envOff) { mode = 'off'; reason = 'environment-off'; }
  else if (embeddingsConfig.enabled === false || mode === 'off') { mode = 'off'; reason = 'configuration-off'; }
  else if (!explicit && policyEnabled === false) { mode = 'off'; reason = 'policy-off'; }
  else if (environment === 'stub') { mode = 'stub'; reason = 'environment-stub'; }
  else if (mode === 'auto') { mode = stubRequested ? 'stub' : 'inline'; reason = stubRequested ? 'cli-stub' : 'automatic-inline'; }
  else { reason = 'configuration-mode'; }
  const embeddingEnabled = mode !== 'off';
  const embeddingService = embeddingEnabled && mode === 'service' && execution !== 'worker';
  if (mode === 'service' && execution === 'worker') {
    mode = stubRequested ? 'stub' : 'inline';
    reason = 'service-worker-inline';
  }
  return {
    normalizedEmbeddingMode,
    resolvedEmbeddingMode: mode,
    embeddingEnabled,
    embeddingService,
    useStubEmbeddings: embeddingEnabled && (mode === 'stub' || stubRequested),
    reason
  };
};
