import fs from 'node:fs';
import path from 'node:path';

const listDirSafe = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const normalizeWorkspaceMarkerSets = (options = {}) => ({
  exact: new Set(
    (Array.isArray(options?.exactNames) ? options.exactNames : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  ),
  exts: new Set(
    (Array.isArray(options?.extensionNames) ? options.extensionNames : [])
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )
});

const scanEntriesForWorkspaceMarker = (entries, { exact, exts }) => {
  for (const entry of entries) {
    if (!entry?.isFile?.()) continue;
    const name = String(entry.name || '').toLowerCase();
    if (!name) continue;
    if (exact.has(name)) return entry.name;
    for (const ext of exts) {
      if (name.endsWith(ext)) return entry.name;
    }
  }
  return null;
};

const normalizeWorkspaceCandidatePath = (value) => (
  String(value || '')
    .split('#')[0]
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.poc-vfs\/+/i, '')
    .replace(/^poc-vfs\/+/i, '')
);

/**
 * Scan repo root and first-level child directories for workspace markers.
 * This keeps detection fast while still covering common monorepo layouts.
 *
 * @param {string} repoRoot
 * @param {{ exactNames?: string[], extensionNames?: string[] }} options
 * @returns {boolean}
 */
export const hasWorkspaceMarker = (repoRoot, options = {}) => {
  const markerSets = normalizeWorkspaceMarkerSets(options);
  const rootEntries = listDirSafe(repoRoot);
  if (scanEntriesForWorkspaceMarker(rootEntries, markerSets)) return true;
  for (const entry of rootEntries) {
    if (!entry?.isDirectory?.()) continue;
    const childEntries = listDirSafe(path.join(repoRoot, entry.name));
    if (scanEntriesForWorkspaceMarker(childEntries, markerSets)) return true;
  }
  return false;
};

const walkWorkspaceMarkerForCandidate = (normalizedRepoRoot, candidate, markerSets) => {
  const visitedDirs = new Set();
  let relativeDir = path.posix.dirname(candidate);
  if (!relativeDir || relativeDir === '.') {
    relativeDir = '';
  }
  while (true) {
    const key = relativeDir || '.';
    if (!visitedDirs.has(key)) {
      visitedDirs.add(key);
      const absDir = relativeDir
        ? path.join(normalizedRepoRoot, relativeDir.replace(/\//g, path.sep))
        : normalizedRepoRoot;
      const entries = listDirSafe(absDir);
      const markerName = scanEntriesForWorkspaceMarker(entries, markerSets);
      if (markerName) {
        return {
          found: true,
          markerDirAbs: absDir,
          markerDirRel: relativeDir || '.',
          markerPathAbs: path.join(absDir, markerName),
          markerName
        };
      }
    }
    if (!relativeDir) break;
    const parentDir = path.posix.dirname(relativeDir);
    if (!parentDir || parentDir === '.' || parentDir === relativeDir) {
      relativeDir = '';
    } else {
      relativeDir = parentDir;
    }
  }
  return null;
};

export const findWorkspaceMarkersNearPaths = (repoRoot, candidatePaths = [], options = {}) => {
  const markerSets = normalizeWorkspaceMarkerSets(options);
  const normalizedRepoRoot = String(repoRoot || process.cwd());
  const normalizedCandidates = Array.isArray(candidatePaths)
    ? candidatePaths
      .map((entry) => normalizeWorkspaceCandidatePath(entry))
      .filter(Boolean)
    : [];
  const matches = [];
  const seenMatches = new Set();
  for (const candidate of normalizedCandidates) {
    const match = walkWorkspaceMarkerForCandidate(normalizedRepoRoot, candidate, markerSets);
    if (!match) continue;
    const dedupeKey = `${match.markerDirRel}|${String(match.markerName || '').toLowerCase()}`;
    if (seenMatches.has(dedupeKey)) continue;
    seenMatches.add(dedupeKey);
    matches.push(match);
  }
  return matches;
};

export const findWorkspaceMarkerNearPaths = (repoRoot, candidatePaths = [], options = {}) => {
  const matches = findWorkspaceMarkersNearPaths(repoRoot, candidatePaths, options);
  if (matches.length > 0) {
    return matches[0];
  }
  return {
    found: false,
    markerDirAbs: null,
    markerDirRel: null,
    markerPathAbs: null,
    markerName: null
  };
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
