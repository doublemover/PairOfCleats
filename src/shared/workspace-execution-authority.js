import fs from 'node:fs';
import path from 'node:path';
import { isRepoTrusted } from './config-authority.js';
import { isPathWithinRoot } from './file-paths.js';

const workspaceExecutionLanguage = ({ providerId, server, languages = [] } = {}) => {
  const id = String(server?.id || providerId || '').trim().toLowerCase();
  const command = path.basename(String(server?.cmd || '').trim()).toLowerCase().replace(/\.(exe|cmd|bat)$/u, '');
  const selectedLanguages = [...(Array.isArray(server?.languages) ? server.languages : []),
    ...(Array.isArray(languages) ? languages : [])].map((language) => String(language || '').trim().toLowerCase());
  if (id === 'rust' || id.includes('rust-analyzer') || command === 'rust-analyzer' || selectedLanguages.includes('rust')) return 'rust';
  if (id === 'zig' || id === 'zls' || id.endsWith('-zls') || command === 'zls' || selectedLanguages.includes('zig')) return 'zig';
  return null;
};

export const isRustWorkspaceExecution = (input) => workspaceExecutionLanguage(input) === 'rust';
export const isWorkspaceBuildExecution = (input) => workspaceExecutionLanguage(input) !== null;

/** Installed tooling is not authority to execute a repository's build machinery. */
export const resolveWorkspaceExecutionAuthority = ({ repoRoot, workspaceRoot = repoRoot, ...input }) => {
  const language = workspaceExecutionLanguage(input);
  if (!language) return null;
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
  const reasonCode = `${language}_workspace_trust_required`;
  const message = language === 'rust'
    ? 'Rust workspace tooling requires an exact launch-owned repository trust grant; native Rust AST analysis remains available.'
    : 'Zig workspace tooling requires an exact launch-owned repository trust grant; Zig is currently a tooling-only route.';
  return { state: 'blocked', blockProvider: true, reasonCode, message,
    check: { name: reasonCode, status: 'warn', message } };
};

export const resolveRustWorkspaceExecutionAuthority = (input) => (
  isRustWorkspaceExecution(input) ? resolveWorkspaceExecutionAuthority(input) : null
);
