import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { toRealPathSync } from '../../src/workspace/identity.js';

const workspaceConfigText = `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [{ "root": "./repo" }]
}`;

export const createWorkspaceFixture = async (prefix = 'pairofcleats-workspace-fixture-') => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const cacheRoot = path.join(tempRoot, 'cache');
  const repoRoot = path.join(tempRoot, 'repo');
  const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
  await fs.writeFile(workspacePath, workspaceConfigText, 'utf8');

  const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
  return {
    tempRoot,
    cacheRoot,
    repoRoot,
    workspacePath,
    repoCacheRoot
  };
};

export const writeIndexArtifacts = async ({
  buildRoot,
  mode = 'code',
  compatibilityKey = 'compat-test'
}) => {
  const indexDir = path.join(buildRoot, `index-${mode}`);
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
    compatibilityKey
  }), 'utf8');
  return { indexDir };
};

export const removeWorkspaceFixture = async (tempRoot) => {
  if (!tempRoot || typeof tempRoot !== 'string') return;
  await fs.rm(tempRoot, { recursive: true, force: true });
};
