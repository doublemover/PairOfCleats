import fs from 'node:fs';
import path from 'node:path';

const listDirSafe = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * Scan repo root and first-level child directories for workspace markers.
 * This keeps detection fast while still covering common monorepo layouts.
 *
 * @param {string} repoRoot
 * @param {{ exactNames?: string[], extensionNames?: string[] }} options
 * @returns {boolean}
 */
export const hasWorkspaceMarker = (repoRoot, options = {}) => {
  const {
    exactNames = [],
    extensionNames = []
  } = options;
  const exact = new Set(exactNames.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const exts = new Set(extensionNames.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const scanEntries = (entries) => {
    for (const entry of entries) {
      if (!entry?.isFile?.()) continue;
      const name = String(entry.name || '').toLowerCase();
      if (!name) continue;
      if (exact.has(name)) return true;
      for (const ext of exts) {
        if (name.endsWith(ext)) return true;
      }
    }
    return false;
  };
  const rootEntries = listDirSafe(repoRoot);
  if (scanEntries(rootEntries)) return true;
  for (const entry of rootEntries) {
    if (!entry?.isDirectory?.()) continue;
    const childEntries = listDirSafe(path.join(repoRoot, entry.name));
    if (scanEntries(childEntries)) return true;
  }
  return false;
};

export const resolveWorkspaceModelCheckForCommand = (commandName) => {
  const command = String(commandName || '').trim().toLowerCase();
  if (!command) return null;
  if (command === 'jdtls') {
    return {
      id: 'workspace-model',
      label: 'Java build model',
      markers: {
        exactNames: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
      }
    };
  }
  if (command === 'csharp-ls' || command === 'omnisharp') {
    return {
      id: 'workspace-model',
      label: 'C# project model',
      markers: {
        extensionNames: ['.sln', '.csproj']
      }
    };
  }
  if (command === 'elixir-ls' || command === 'elixir-ls-language-server') {
    return {
      id: 'workspace-model',
      label: 'Elixir project model',
      markers: {
        exactNames: ['mix.exs']
      }
    };
  }
  if (command === 'haskell-language-server') {
    return {
      id: 'workspace-model',
      label: 'Haskell project model',
      markers: {
        exactNames: ['stack.yaml', 'cabal.project'],
        extensionNames: ['.cabal']
      }
    };
  }
  if (command === 'phpactor') {
    return {
      id: 'workspace-model',
      label: 'PHP project model',
      markers: {
        exactNames: ['composer.json']
      }
    };
  }
  if (command === 'solargraph') {
    return {
      id: 'workspace-model',
      label: 'Ruby project model',
      markers: {
        exactNames: ['gemfile']
      }
    };
  }
  if (command === 'dart') {
    return {
      id: 'workspace-model',
      label: 'Dart project model',
      markers: {
        exactNames: ['pubspec.yaml']
      }
    };
  }
  return null;
};
