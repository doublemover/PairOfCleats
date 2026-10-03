import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

export const createBenchLanguageRepoFixture = async ({
  name,
  repoId,
  readme = 'bench language fixture'
}) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, name);
  const reposRoot = path.join(tempRoot, 'repos');
  const cacheRoot = path.join(tempRoot, 'cache');
  const resultsRoot = path.join(tempRoot, 'results');
  const configPath = path.join(tempRoot, 'repos.json');
  const queriesPath = path.join(root, 'tests', 'fixtures', 'sample', 'queries.txt');
  const repoPath = path.join(reposRoot, 'javascript', repoId.replace('/', '__'));

  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(repoPath, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.mkdir(resultsRoot, { recursive: true });
  await fsPromises.writeFile(path.join(repoPath, 'README.md'), readme);
  await fsPromises.writeFile(configPath, JSON.stringify({
    javascript: {
      label: 'JavaScript',
      queries: queriesPath,
      repos: {
        small: [repoId]
      }
    }
  }, null, 2));

  return {
    cacheRoot,
    configPath,
    reposRoot,
    resultsRoot,
    root,
    scriptPath: path.join(root, 'tools', 'bench', 'language-repos.js'),
    tempRoot
  };
};

export const runBenchLanguageRepos = ({
  fixture,
  args = [],
  timeout = undefined
}) => runNode(
  [
    fixture.scriptPath,
    '--config',
    fixture.configPath,
    '--root',
    fixture.reposRoot,
    '--cache-root',
    fixture.cacheRoot,
    '--results',
    fixture.resultsRoot,
    '--no-clone',
    '--dry-run',
    ...args
  ],
  'bench language repos',
  fixture.root,
  applyTestEnv({ syncProcess: false }),
  { stdio: 'pipe', encoding: 'utf8', timeoutMs: timeout, allowFailure: true }
);
