import fs from 'node:fs/promises';
import path from 'node:path';

import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';

export const DEFAULT_FEDERATION_BUILD_ID = 'test-build';

export const createFederationIndexDescriptor = ({
  repoCacheRoot,
  buildId = DEFAULT_FEDERATION_BUILD_ID,
  modes = ['code']
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  const indexes = Object.fromEntries(modes.map((mode) => [
    mode,
    {
      mode,
      indexDir: path.join(buildRoot, `index-${mode}`),
      compatibilityKey: `compat-${mode}`
    }
  ]));
  return {
    buildId,
    buildRoot,
    buildPointer: {
      buildId,
      buildRoot,
      modes
    },
    indexes
  };
};

export const writeFederationRepoFixture = async ({
  repoRoot,
  cacheRoot,
  modes = ['code'],
  buildId = DEFAULT_FEDERATION_BUILD_ID
}) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');

  const repoCacheRoot = getRepoCacheRoot(repoRoot);
  const descriptor = createFederationIndexDescriptor({ repoCacheRoot, buildId, modes });
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(
    path.join(repoCacheRoot, 'builds', 'current.json'),
    JSON.stringify(descriptor.buildPointer, null, 2),
    'utf8'
  );
  for (const index of Object.values(descriptor.indexes)) {
    await fs.mkdir(index.indexDir, { recursive: true });
    await fs.writeFile(path.join(index.indexDir, 'chunk_meta.json'), '[]', 'utf8');
    await fs.writeFile(path.join(index.indexDir, 'token_postings.json'), '{}', 'utf8');
    await fs.writeFile(path.join(index.indexDir, 'index_state.json'), JSON.stringify({
      compatibilityKey: index.compatibilityKey
    }, null, 2), 'utf8');
  }
  return {
    repoCacheRoot,
    ...descriptor
  };
};
