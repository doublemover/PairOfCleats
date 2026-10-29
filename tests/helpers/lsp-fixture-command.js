import path from 'node:path';

/** Command identity without importing or registering production providers. */
export const resolveLspFixtureCommand = (commandName, { repoRoot = process.cwd() } = {}) => path.join(
  repoRoot,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? `${commandName}.cmd` : commandName
);
