import fs from 'node:fs';
import path from 'node:path';
import { isRepoTrusted } from './config-authority.js';
import { isPathWithinRoot } from './file-paths.js';

export const isRustWorkspaceExecution = ({ providerId, server, languages = [] } = {}) => {
  const id = String(server?.id || providerId || '').trim().toLowerCase();
  const command = path.basename(String(server?.cmd || '').trim()).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '');
  return id === 'rust' || id.includes('rust-analyzer') || command === 'rust-analyzer'
    || [...(Array.isArray(server?.languages) ? server.languages : []), ...languages]
      .some((language) => String(language || '').trim().toLowerCase() === 'rust');
};

/** Installed tooling is not authority to execute a repository's build machinery. */
export const resolveRustWorkspaceExecutionAuthority = ({ repoRoot, workspaceRoot = repoRoot, ...input }) => {
  if (!isRustWorkspaceExecution(input)) return null;
  let approved = isRepoTrusted(repoRoot);
  if (approved && workspaceRoot) {
    try {
      const root = fs.realpathSync(repoRoot);
      const workspace = fs.realpathSync(workspaceRoot);
      approved = isPathWithinRoot(workspace, root) || isRepoTrusted(workspace);
    } catch {
      approved = false;
    }
  }
  if (approved) return null;
  const reasonCode = 'rust_workspace_trust_required';
  const message = 'Rust workspace tooling requires an exact launch-owned repository trust grant; native Rust AST analysis remains available.';
  return { state: 'blocked', blockProvider: true, reasonCode, message,
    check: { name: reasonCode, status: 'warn', message } };
};
