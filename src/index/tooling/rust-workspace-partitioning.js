import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { findWorkspaceMarkersNearPaths } from './workspace-model.js';

export const normalizeRustWorkspaceRootRel = (value) => {
  const normalized = String(value || '.')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return normalized || '.';
};

export const isRustWorkspaceProviderId = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'rust-analyzer' || normalized === 'lsp-rust-analyzer' || normalized.includes('rust-analyzer');
};

const RUST_WORKSPACE_MARKER_OPTIONS = Object.freeze({
  exactNames: Object.freeze(['Cargo.toml', 'Cargo.lock'])
});

const EXAMPLE_LIKE_SEGMENTS = new Set([
  'bench',
  'benches',
  'demo',
  'demos',
  'example',
  'examples',
  'sample',
  'samples'
]);

const normalizePathSegments = (value) => normalizeRustWorkspaceRootRel(value)
  .split('/')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const isExampleLikeRoot = (rootRel) => normalizePathSegments(rootRel).some((segment) => EXAMPLE_LIKE_SEGMENTS.has(segment));

const hasObjectKey = (value, key) => (
  value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)
);

const readCargoToml = (cargoTomlPath) => {
  if (!fsSync.existsSync(cargoTomlPath)) {
    return {
      exists: false,
      parsed: null,
      parseError: null
    };
  }
  try {
    return {
      exists: true,
      parsed: parseToml(fsSync.readFileSync(cargoTomlPath, 'utf8')),
      parseError: null
    };
  } catch (error) {
    return {
      exists: true,
      parsed: null,
      parseError: error
    };
  }
};

const resolveAncestorWorkspaceRoot = (repoRoot, workspaceRoot) => {
  const repoAbs = path.resolve(String(repoRoot || process.cwd()));
  let current = path.resolve(String(workspaceRoot || repoAbs));
  while (current.length >= repoAbs.length) {
    if (current === repoAbs) break;
    const parentDir = path.dirname(current);
    if (!parentDir || parentDir === current) break;
    if (!parentDir.startsWith(repoAbs)) break;
    const parentCargoToml = readCargoToml(path.join(parentDir, 'Cargo.toml'));
    if (parentCargoToml.exists && !parentCargoToml.parseError && hasObjectKey(parentCargoToml.parsed, 'workspace')) {
      return {
        found: true,
        rootDir: parentDir,
        rootRel: normalizeRustWorkspaceRootRel(path.relative(repoAbs, parentDir))
      };
    }
    current = parentDir;
  }
  return {
    found: false,
    rootDir: null,
    rootRel: null
  };
};

export const classifyRustWorkspaceManifest = ({
  repoRoot,
  rootDir,
  rootRel = '.'
} = {}) => {
  const resolvedRepoRoot = path.resolve(String(repoRoot || process.cwd()));
  const resolvedRootDir = path.resolve(String(rootDir || resolvedRepoRoot));
  const resolvedRootRel = normalizeRustWorkspaceRootRel(rootRel);
  const cargoTomlPath = path.join(resolvedRootDir, 'Cargo.toml');
  const cargoLockPath = path.join(resolvedRootDir, 'Cargo.lock');
  const manifest = readCargoToml(cargoTomlPath);
  const exampleLike = isExampleLikeRoot(resolvedRootRel);
  const parentWorkspace = resolveAncestorWorkspaceRoot(resolvedRepoRoot, resolvedRootDir);

  if (!manifest.exists) {
    const message = fsSync.existsSync(cargoLockPath)
      ? 'Cargo.lock exists without a matching Cargo.toml session root.'
      : 'Cargo workspace markers were not found for this partition.';
    return {
      role: 'tooling_only',
      validSessionRoot: false,
      reasonCode: 'rust_workspace_tooling_only_root',
      message,
      markerPath: cargoTomlPath,
      cargoTomlPath,
      cargoLockPath,
      exampleLike,
      parentWorkspace
    };
  }

  if (manifest.parseError) {
    return {
      role: parentWorkspace.found ? 'broken_member' : 'broken_member',
      validSessionRoot: false,
      reasonCode: 'rust_workspace_broken_manifest',
      message: `Cargo.toml could not be parsed: ${manifest.parseError.message || 'unknown parse error'}`,
      markerPath: cargoTomlPath,
      cargoTomlPath,
      cargoLockPath,
      exampleLike,
      parentWorkspace
    };
  }

  const parsed = manifest.parsed;
  const hasWorkspace = hasObjectKey(parsed, 'workspace');
  const hasPackage = hasObjectKey(parsed, 'package');

  if (hasWorkspace) {
    return {
      role: 'workspace_root',
      validSessionRoot: true,
      reasonCode: null,
      message: '',
      markerPath: cargoTomlPath,
      cargoTomlPath,
      cargoLockPath,
      exampleLike,
      parentWorkspace
    };
  }

  if (hasPackage) {
    return {
      role: exampleLike
        ? 'example_fragment'
        : (parentWorkspace.found ? 'workspace_member' : 'standalone_root'),
      validSessionRoot: true,
      reasonCode: null,
      message: '',
      markerPath: cargoTomlPath,
      cargoTomlPath,
      cargoLockPath,
      exampleLike,
      parentWorkspace
    };
  }

  return {
    role: 'tooling_only',
    validSessionRoot: false,
    reasonCode: 'rust_workspace_tooling_only_root',
    message: 'Cargo.toml does not declare [package] or [workspace], so it is not a runnable rust-analyzer session root.',
    markerPath: cargoTomlPath,
    cargoTomlPath,
    cargoLockPath,
    exampleLike,
    parentWorkspace
  };
};

export const buildRustWorkspacePartitionFingerprint = ({
  repoRoot,
  rootRel = '.',
  markerName = 'Cargo.toml',
  role = 'standalone_root'
} = {}) => {
  const hash = crypto.createHash('sha1');
  hash.update(path.resolve(String(repoRoot || process.cwd())).toLowerCase());
  hash.update('|');
  hash.update(normalizeRustWorkspaceRootRel(rootRel));
  hash.update('|');
  hash.update(String(markerName || 'Cargo.toml').trim().toLowerCase() || 'cargo.toml');
  hash.update('|');
  hash.update(String(role || 'standalone_root').trim().toLowerCase() || 'standalone_root');
  return hash.digest('hex').slice(0, 16);
};

export const buildRustWorkspacePartitionKey = ({
  repoRoot,
  rootRel = '.',
  markerName = 'Cargo.toml',
  role = 'standalone_root'
} = {}) => (
  `rust:${buildRustWorkspacePartitionFingerprint({
    repoRoot,
    rootRel,
    markerName,
    role
  })}`
);

export const resolveRustWorkspacePartitionRole = ({
  repoRoot,
  rootDir,
  rootRel = '.'
} = {}) => classifyRustWorkspaceManifest({
  repoRoot,
  rootDir,
  rootRel
}).role;

export const buildSelectedRustWorkspacePartitions = (repoRoot, selectedRustPaths) => {
  const partitionByRoot = new Map();
  const unmatchedPaths = [];
  const resolvedRepoRoot = path.resolve(String(repoRoot || process.cwd()));
  for (const selectedPath of Array.isArray(selectedRustPaths) ? selectedRustPaths : []) {
    const matches = findWorkspaceMarkersNearPaths(
      resolvedRepoRoot,
      [selectedPath],
      RUST_WORKSPACE_MARKER_OPTIONS
    );
    const match = matches.length > 0 ? matches[0] : null;
    if (!match) {
      unmatchedPaths.push(String(selectedPath));
      continue;
    }
    const rootRel = normalizeRustWorkspaceRootRel(match.markerDirRel || '.');
    if (partitionByRoot.has(rootRel)) {
      partitionByRoot.get(rootRel).selectedPaths.push(String(selectedPath));
      continue;
    }
    const rootDir = String(match.markerDirAbs || resolvedRepoRoot);
    const classification = classifyRustWorkspaceManifest({
      repoRoot: resolvedRepoRoot,
      rootDir,
      rootRel
    });
    partitionByRoot.set(rootRel, {
      rootRel,
      rootDir,
      markerName: String(match.markerName || 'Cargo.toml').trim() || 'Cargo.toml',
      workspaceKey: buildRustWorkspacePartitionKey({
        repoRoot: resolvedRepoRoot,
        rootRel,
        markerName: match.markerName || 'Cargo.toml',
        role: classification.role
      }),
      role: classification.role,
      validSessionRoot: classification.validSessionRoot === true,
      classificationReasonCode: classification.reasonCode || null,
      classificationMessage: classification.message || '',
      cargoTomlPath: classification.cargoTomlPath,
      cargoLockPath: classification.cargoLockPath,
      exampleLike: classification.exampleLike === true,
      selectedPaths: [String(selectedPath)]
    });
  }
  return {
    partitions: Array.from(partitionByRoot.values())
      .sort((left, right) => String(left.rootRel || '.').localeCompare(String(right.rootRel || '.'))),
    unmatchedPaths
  };
};
