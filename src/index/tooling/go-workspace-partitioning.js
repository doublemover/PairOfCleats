import crypto from 'node:crypto';
import path from 'node:path';

export const normalizeWorkspaceRootRel = (value) => {
  const normalized = String(value || '.')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  return normalized || '.';
};

export const isGoWorkspaceProviderId = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'gopls' || normalized === 'lsp-gopls' || normalized.includes('gopls');
};

const collectPartitionVirtualPaths = ({ documents = [], targets = [] } = {}) => {
  const values = new Set();
  for (const doc of Array.isArray(documents) ? documents : []) {
    const virtualPath = String(doc?.virtualPath || doc?.path || '').trim();
    if (virtualPath) values.add(virtualPath);
  }
  for (const target of Array.isArray(targets) ? targets : []) {
    const virtualPath = String(target?.virtualPath || target?.chunkRef?.file || '').trim();
    if (virtualPath) values.add(virtualPath);
  }
  return Array.from(values);
};

export const classifyGoWorkspacePartitionScope = ({
  documents = [],
  targets = []
} = {}) => {
  const paths = collectPartitionVirtualPaths({ documents, targets }).map((entry) => entry.toLowerCase());
  if (paths.some((entry) => entry.includes('/vendor/'))) return 'vendor';
  if (paths.some((entry) => (
    entry.includes('/gen/')
    || entry.includes('/generated/')
    || entry.endsWith('.pb.go')
    || entry.endsWith('.generated.go')
  ))) {
    return 'generated';
  }
  return 'module';
};

export const buildGoWorkspacePartitionFingerprint = ({
  repoRoot,
  rootRel = '.',
  markerName = 'go.mod',
  scope = 'module'
} = {}) => {
  const hash = crypto.createHash('sha1');
  hash.update(path.resolve(String(repoRoot || process.cwd())).toLowerCase());
  hash.update('|');
  hash.update(normalizeWorkspaceRootRel(rootRel));
  hash.update('|');
  hash.update(String(markerName || 'go.mod').trim().toLowerCase() || 'go.mod');
  hash.update('|');
  hash.update(String(scope || 'module').trim().toLowerCase() || 'module');
  return hash.digest('hex').slice(0, 16);
};

export const buildGoWorkspacePartitionKey = ({
  repoRoot,
  rootRel = '.',
  markerName = 'go.mod',
  scope = 'module'
} = {}) => (
  `go:${buildGoWorkspacePartitionFingerprint({
    repoRoot,
    rootRel,
    markerName,
    scope
  })}`
);
