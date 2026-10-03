export function applyEnvPatch(baseEnv, envPatch) {
  const env = { ...(baseEnv || {}) };
  const setEntries = envPatch?.set && typeof envPatch.set === 'object' ? envPatch.set : {};
  for (const [key, value] of Object.entries(setEntries)) {
    if (value == null) continue;
    env[key] = String(value);
  }
  if (envPatch?.nodeOptions) {
    env.NODE_OPTIONS = String(envPatch.nodeOptions);
  }
  return env;
}

export function resolveRuntimeEnv(envelope, baseEnv = {}) {
  if (!envelope || typeof envelope !== 'object') return { ...(baseEnv || {}) };
  return applyEnvPatch(baseEnv, envelope.envPatch || {});
}
