import { buildSqliteIndex } from '../../src/integrations/core/index.js';
import { getCurrentBuildInfo, loadUserConfig, resolveIndexRoot } from '../../tools/shared/dict-utils.js';

const withTemporaryEnv = async (overrides, callback) => {
  if (!overrides || typeof overrides !== 'object') {
    return callback();
  }
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(
      key,
      Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined
    );
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

export const resolveSqliteIndexRoot = (repoRoot, mode = null, explicitIndexRoot = null) => {
  if (explicitIndexRoot) return explicitIndexRoot;
  const userConfig = loadUserConfig(repoRoot);
  const modeHint = typeof mode === 'string' && mode.trim().toLowerCase() === 'all'
    ? undefined
    : (mode || undefined);
  const buildInfo = getCurrentBuildInfo(repoRoot, userConfig, { mode: modeHint });
  if (buildInfo?.activeRoot) {
    return buildInfo.activeRoot;
  }
  try {
    const fallbackRoot = resolveIndexRoot(repoRoot, userConfig);
    if (fallbackRoot) return fallbackRoot;
  } catch {}
  throw new Error('Missing index root for sqlite build. Ensure build_index has completed first.');
};

export const runSqliteBuild = async (repoRoot, options = {}) => {
  return withTemporaryEnv(options.env || null, async () => {
    const mode = options.mode || 'all';
    const indexRoot = resolveSqliteIndexRoot(repoRoot, mode, options.indexRoot || null);
    return buildSqliteIndex(repoRoot, {
      mode,
      incremental: options.incremental === true,
      compact: options.compact === true,
      out: options.out || null,
      indexRoot,
      codeDir: options.codeDir || null,
      proseDir: options.proseDir || null,
      extractedProseDir: options.extractedProseDir || null,
      recordsDir: options.recordsDir || null,
      validateMode: options.validateMode ?? options.validate,
      emitOutput: options.emitOutput !== false,
      exitOnError: options.exitOnError === true,
      logger: options.logger || null
    });
  });
};
