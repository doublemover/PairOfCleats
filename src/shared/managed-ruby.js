import path from 'node:path';

/** Bind only a selected cache launcher to the gem repository used by installation. */
export const applyManagedRubyEnvironment = (baseEnv, { toolingRoot, command = '' } = {}) => {
  const env = { ...(baseEnv || {}) };
  if (!toolingRoot || typeof command !== 'string' || !path.isAbsolute(command)) return env;
  const name = path.basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '');
  if (!['solargraph', 'ruby-lsp'].includes(name)) return env;
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(path.dirname(path.resolve(command))) !== normalize(path.resolve(toolingRoot, 'bin'))) return env;
  const gems = path.resolve(toolingRoot, 'gems');
  const explicitSearch = String(env.GEM_PATH || '');
  const entries = [gems, ...explicitSearch.split(path.delimiter).filter(Boolean)];
  const seen = new Set();
  env.GEM_HOME = env.GEM_HOME || gems;
  env.GEM_PATH = entries.filter(entry => {
    const key = normalize(entry);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).join(path.delimiter);
  // RubyGems appends its defaults when the search path ends with a delimiter.
  if (!explicitSearch || explicitSearch.endsWith(path.delimiter)) env.GEM_PATH += path.delimiter;
  return env;
};
