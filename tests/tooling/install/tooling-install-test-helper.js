import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

export const runToolingInstallWithEmptyPath = (toolId) => {
  const root = process.cwd();
  const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
  const scriptPath = path.join(root, 'tools', 'tooling', 'install.js');
  const env = applyTestEnv({
    extraEnv: {
      PATH: '',
      Path: ''
    },
    syncProcess: false
  });

  const result = runNode(
    [scriptPath, '--root', fixtureRoot, '--tools', toolId, '--json'],
    `tooling install empty PATH ${toolId}`,
    root,
    env,
    {
      stdio: 'pipe',
      allowFailure: true
    }
  );

  let payload = null;
  try {
    payload = JSON.parse(String(result.stdout || '{}'));
  } catch {
    throw new Error('tooling-install helper failed: stdout was not valid JSON');
  }

  return { result, payload };
};
