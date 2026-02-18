import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startApiServer } from './api-server.js';

export const createFederatedTempRoot = async (prefix) => (
  fs.mkdtemp(path.join(os.tmpdir(), prefix))
);

export const writeFederatedWorkspaceConfig = async (workspacePath, config) => {
  await fs.mkdir(path.dirname(workspacePath), { recursive: true });
  await fs.writeFile(workspacePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
};

export const startFederatedApiServer = async ({
  repoRoot,
  allowedRoots = [],
  envOverrides = {},
  ...options
} = {}) => startApiServer({
  repoRoot,
  allowedRoots,
  env: {
    ...process.env,
    ...envOverrides
  },
  ...options
});

