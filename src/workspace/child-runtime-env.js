import { resolveDispatchRuntimeEnv } from '../../bin/dispatch-runtime-env.js';

export const resolveWorkspaceChildRuntimeEnv = ({ repoRoot, buildArgs = [], baseEnv = process.env }) => (
  resolveDispatchRuntimeEnv({ root: repoRoot, scriptPath: 'build_index.js',
    restArgs: [...buildArgs, '--repo', repoRoot], baseEnv: { ...baseEnv } })
);
