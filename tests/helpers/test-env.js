export const DEFAULT_TEST_ENV_KEYS = [
  'PAIROFCLEATS_TESTING',
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_EMBEDDINGS',
  'PAIROFCLEATS_TEST_CONFIG'
];

export const syncProcessEnv = (env, keys = DEFAULT_TEST_ENV_KEYS) => {
  if (!env || typeof env !== 'object') return;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
    const value = env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
};

export const applyTestEnv = ({
  cacheRoot,
  embeddings,
  testing = '1',
  testConfig,
  extraEnv
} = {}) => {
  const env = { ...process.env };
  if (testing !== undefined && testing !== null) {
    env.PAIROFCLEATS_TESTING = String(testing);
  }
  if (cacheRoot) {
    env.PAIROFCLEATS_CACHE_ROOT = String(cacheRoot);
  }
  if (embeddings !== undefined) {
    if (embeddings === null) {
      delete env.PAIROFCLEATS_EMBEDDINGS;
    } else {
      env.PAIROFCLEATS_EMBEDDINGS = String(embeddings);
    }
  }
  if (testConfig !== undefined) {
    if (testConfig === null) {
      delete env.PAIROFCLEATS_TEST_CONFIG;
    } else if (typeof testConfig === 'string') {
      env.PAIROFCLEATS_TEST_CONFIG = testConfig;
    } else {
      env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify(testConfig);
    }
  }
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined || value === null) {
        delete env[key];
      } else {
        env[key] = String(value);
      }
    }
  }
  const syncKeys = Object.keys(env).filter((key) => key.startsWith('PAIROFCLEATS_'));
  syncProcessEnv(env, syncKeys);
  return env;
};

export const shouldLogSilent = () => {
  const value = process.env.PAIROFCLEATS_TEST_LOG_SILENT;
  return value === '1' || value === 'true';
};

export const resolveSilentStdio = (defaultStdio = 'ignore') => (
  shouldLogSilent() ? 'inherit' : defaultStdio
);

export const attachSilentLogging = (child, label = null) => {
  if (!shouldLogSilent() || !child) return;
  const prefix = label ? `[${label}] ` : '';
  const forward = (stream) => {
    if (!stream) return;
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      if (!text) return;
      if (!prefix) {
        process.stderr.write(text);
        return;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line && i === lines.length - 1) continue;
        process.stderr.write(`${prefix}${line}\n`);
      }
    });
  };
  forward(child.stdout);
  forward(child.stderr);
};
