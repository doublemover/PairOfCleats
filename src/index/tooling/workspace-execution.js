import fs from 'node:fs';
import path from 'node:path';
import { isRepoTrusted } from '../../shared/config-authority.js';
import { isPathWithinRoot } from '../../shared/file-paths.js';
import { resolveWorkspaceExecutionAuthority, isWorkspaceBuildExecution } from '../../shared/workspace-execution-authority.js';

/** Phpactor can include Composer-generated PHP and trusted project extensions.
 * A tool selection is distinct from permission to execute that repository. */
export const isProviderWorkspaceExecution = ({ providerId, server, languages, requiresWorkspaceExecution } = {}) => {
  const command = path.basename(String(server?.cmd || '')).toLowerCase().replace(/\.(exe|cmd|bat|phar)$/u, '');
  return requiresWorkspaceExecution === true || server?.requiresWorkspaceExecution === true
    || String(server?.workspaceExecutionProfile || server?.id || providerId || '').toLowerCase() === 'phpactor'
    || command === 'phpactor' || isWorkspaceBuildExecution({ providerId, server, languages });
};

export const resolveProviderWorkspaceExecutionAuthority = ({ repoRoot, workspaceRoot = repoRoot, ...input }) => {
  const existing = resolveWorkspaceExecutionAuthority({ repoRoot, workspaceRoot, ...input });
  if (existing) return existing;
  if (!isProviderWorkspaceExecution(input)) return null;
  let authorized = isRepoTrusted(repoRoot);
  if (authorized) {
    try { authorized = isPathWithinRoot(fs.realpathSync(workspaceRoot), fs.realpathSync(repoRoot)) || isRepoTrusted(workspaceRoot); }
    catch { authorized = false; }
  }
  if (authorized) return null;
  const providerId = String(input.providerId || input.server?.workspaceExecutionProfile || input.server?.id || 'provider');
  const reasonCode = `${providerId}_workspace_trust_required`;
  const message = `${providerId} requires an exact launch-owned repository trust grant before project loaders, build hooks or extensions may execute.`;
  return { state: 'blocked', blockProvider: true, reasonCode, message,
    check: { name: reasonCode, status: 'warn', message } };
};
