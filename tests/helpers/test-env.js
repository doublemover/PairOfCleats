export const DEFAULT_TEST_ENV_KEYS = [
  'PAIROFCLEATS_TESTING',
  'PAIROFCLEATS_CACHE_ROOT',
  'PAIROFCLEATS_EMBEDDINGS',
  'PAIROFCLEATS_TEST_CONFIG'
];

export const syncProcessEnv = (env, keys = DEFAULT_TEST_ENV_KEYS, { clearMissing = false } = {}) => {
  if (!env || typeof env !== 'object') return;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      if (clearMissing) delete process.env[key];
      continue;
    }
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
  const deletedKeys = new Set();
  const preservedTestKeys = new Set([
    'PAIROFCLEATS_TEST_CACHE_SUFFIX',
    'PAIROFCLEATS_TEST_LOG_SILENT',
    'PAIROFCLEATS_TEST_ALLOW_MISSING_COMPAT_KEY',
    'PAIROFCLEATS_TESTING',
    'PAIROFCLEATS_TEST_CONFIG'
  ]);
  for (const key of Object.keys(env)) {
    if (!key.startsWith('PAIROFCLEATS_TEST_')) continue;
    if (preservedTestKeys.has(key)) continue;
    delete env[key];
    deletedKeys.add(key);
  }
  const removeKey = (key) => {
    delete env[key];
    if (key && key.startsWith('PAIROFCLEATS_')) deletedKeys.add(key);
  };
  if (testing !== undefined && testing !== null) {
    env.PAIROFCLEATS_TESTING = String(testing);
  }
  if (cacheRoot) {
    env.PAIROFCLEATS_CACHE_ROOT = String(cacheRoot);
  }
  if (embeddings !== undefined) {
    if (embeddings === null) {
      removeKey('PAIROFCLEATS_EMBEDDINGS');
    } else {
      env.PAIROFCLEATS_EMBEDDINGS = String(embeddings);
    }
  }
  if (testConfig === undefined) {
    // Preserve inherited test config unless explicitly overridden by the caller.
  } else if (testConfig === null) {
    removeKey('PAIROFCLEATS_TEST_CONFIG');
  } else if (typeof testConfig === 'string') {
    env.PAIROFCLEATS_TEST_CONFIG = testConfig;
  } else {
    env.PAIROFCLEATS_TEST_CONFIG = JSON.stringify(testConfig);
  }
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined || value === null) {
        removeKey(key);
      } else {
        env[key] = String(value);
      }
    }
  }
  const syncKeys = new Set(DEFAULT_TEST_ENV_KEYS);
  for (const key of Object.keys(env)) {
    if (key.startsWith('PAIROFCLEATS_')) syncKeys.add(key);
  }
  for (const key of deletedKeys) syncKeys.add(key);
  syncProcessEnv(env, Array.from(syncKeys), { clearMissing: true });
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
