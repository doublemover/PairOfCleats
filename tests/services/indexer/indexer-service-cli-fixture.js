import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

export const createIndexerServiceCliFixture = async ({
  cacheName,
  config = {}
} = {}) => {
  if (!cacheName) {
    throw new TypeError('createIndexerServiceCliFixture requires cacheName');
  }

  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, cacheName);
  const repoRoot = path.join(tempRoot, 'repo');
  const queueDir = path.join(tempRoot, 'queue');
  const configPath = path.join(tempRoot, 'service.json');
  const scriptPath = path.join(root, 'tools', 'service', 'indexer-service.js');

  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(repoRoot, { recursive: true });

  const resolvedConfig = typeof config === 'function'
    ? config({ root, tempRoot, repoRoot, queueDir, configPath })
    : config;
  const serviceConfig = {
    queueDir,
    ...(resolvedConfig || {}),
    repos: resolvedConfig?.repos || [
      { id: 'repo', path: repoRoot, syncPolicy: 'none' }
    ]
  };
  await fsPromises.writeFile(configPath, JSON.stringify(serviceConfig, null, 2));

  const env = applyTestEnv({ syncProcess: false });
  const runCli = (...args) => runNode(
    [scriptPath, ...args],
    `indexer-service ${args[0] || 'cli'}`,
    root,
    env,
    { stdio: 'pipe', encoding: 'utf8', allowFailure: true }
  );
  const parseCliJson = (result) => JSON.parse(result.stdout || '{}');
  const runCliJson = (...args) => {
    const result = runCli(...args);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `indexer-service ${args[0]} failed`);
    }
    return parseCliJson(result);
  };

  return {
    root,
    tempRoot,
    repoRoot,
    queueDir,
    configPath,
    scriptPath,
    runCli,
    parseCliJson,
    runCliJson
  };
};
