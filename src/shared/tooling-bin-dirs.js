import fs from 'node:fs';
import path from 'node:path';

const dedupePaths = (entries) => {
  const seen = new Set();
  const result = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const value = String(entry || '').trim();
    if (!value) continue;
    const key = process.platform === 'win32' ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
};

const resolveHomeDir = () => {
  const home = process.platform === 'win32'
    ? (process.env.USERPROFILE || process.env.HOME || '')
    : (process.env.HOME || process.env.USERPROFILE || '');
  return String(home || '').trim();
};

const splitPathEntries = (value) => String(value || '')
  .split(path.delimiter)
  .map((entry) => String(entry || '').trim())
  .filter(Boolean);

const expandRubyVersionBinDirs = (baseDir) => {
  const root = path.join(baseDir, 'ruby');
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'bin'));
};

export const resolveGlobalDotnetBinDirs = () => {
  const home = resolveHomeDir();
  if (!home) return [];
  return [path.join(home, '.dotnet', 'tools')];
};

export const resolveGlobalComposerBinDirs = () => {
  const home = resolveHomeDir();
  const appData = String(process.env.APPDATA || '').trim();
  const xdgConfigHome = String(process.env.XDG_CONFIG_HOME || '').trim();
  return dedupePaths([
    appData ? path.join(appData, 'Composer', 'vendor', 'bin') : '',
    xdgConfigHome ? path.join(xdgConfigHome, 'composer', 'vendor', 'bin') : '',
    home ? path.join(home, '.config', 'composer', 'vendor', 'bin') : '',
    home ? path.join(home, '.composer', 'vendor', 'bin') : ''
  ]);
};

export const resolveGlobalPhpactorBinDirs = () => {
  const home = resolveHomeDir();
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  return dedupePaths([
    localAppData ? path.join(localAppData, 'Programs', 'phpactor') : '',
    home ? path.join(home, '.local', 'bin') : ''
  ]);
};

export const resolveGlobalGemBinDirs = () => {
  const home = resolveHomeDir();
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  const gemHome = String(process.env.GEM_HOME || '').trim();
  const gemPathEntries = splitPathEntries(process.env.GEM_PATH || '');
  const userGemRoots = [
    home ? path.join(home, '.local', 'share', 'gem') : '',
    home ? path.join(home, '.gem') : ''
  ].filter(Boolean);
  const versionedGemBins = userGemRoots.flatMap((root) => expandRubyVersionBinDirs(root));
  return dedupePaths([
    localAppData ? path.join(localAppData, 'Microsoft', 'WindowsApps') : '',
    gemHome ? path.join(gemHome, 'bin') : '',
    ...gemPathEntries.map((entry) => path.join(entry, 'bin')),
    ...versionedGemBins
  ]);
};

export const resolveLocalToolingBinDirs = (toolingRoot) => {
  const absoluteToolingRoot = path.resolve(String(toolingRoot || '.'));
  return dedupePaths([
    path.join(absoluteToolingRoot, 'bin'),
    path.join(absoluteToolingRoot, 'node', 'node_modules', '.bin'),
    path.join(absoluteToolingRoot, 'dotnet'),
    path.join(absoluteToolingRoot, 'composer', 'vendor', 'bin')
  ]);
};

export const resolveGlobalToolingBinDirs = () => dedupePaths([
  ...resolveGlobalDotnetBinDirs(),
  ...resolveGlobalComposerBinDirs(),
  ...resolveGlobalPhpactorBinDirs(),
  ...resolveGlobalGemBinDirs()
]);

export const resolveExtendedToolingBinDirs = (toolingRoot) => dedupePaths([
  ...resolveLocalToolingBinDirs(toolingRoot),
  ...resolveGlobalToolingBinDirs()
]);
