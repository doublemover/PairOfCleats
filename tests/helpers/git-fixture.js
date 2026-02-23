import { spawnSync } from 'node:child_process';

export const ensureGitAvailableOrSkip = () => {
  const gitCheck = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (gitCheck.status === 0) return true;
  console.log('[skip] git not available');
  return false;
};

export const runGit = (args, { cwd, label = null } = {}) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    const commandLabel = label || `git ${args.join(' ')}`;
    const details = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${commandLabel} failed${details ? `: ${details}` : ''}`);
  }
  return result;
};

export const initGitRepo = (repoRoot, {
  userEmail = 'test@example.com',
  userName = 'Test User'
} = {}) => {
  runGit(['init'], { cwd: repoRoot, label: 'git init' });
  runGit(['config', 'user.email', userEmail], { cwd: repoRoot, label: 'git config email' });
  runGit(['config', 'user.name', userName], { cwd: repoRoot, label: 'git config name' });
};
