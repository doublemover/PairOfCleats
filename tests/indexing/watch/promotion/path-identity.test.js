import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { seedPublishedArtifacts } from '../../../helpers/artifact-publication.js';
import { promoteBuild } from '../../../../src/index/build/promotion.js';
import { getBuildsRoot, getCurrentBuildInfo } from '../../../../src/shared/dict-utils.js';
import { normalizeIdentityPath } from '../../../../src/workspace/identity.js';
import { assertArtifactPublicationReady, resolveArtifactPublicationPath } from '../../../../src/index/build/artifact-publication.js';

const { dir } = await prepareIsolatedTestCacheDir('promotion-path-identity');
const repoRoot = path.join(dir, 'repo'); await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: true });
const userConfig = {}, buildId = 'case-normalized-root';
const buildRoot = path.join(getBuildsRoot(repoRoot, userConfig), buildId);
await fs.mkdir(buildRoot, { recursive: true });
await seedPublishedArtifacts({ buildRoot, buildId, mode: 'code' });
const requested = process.platform === 'win32'
  ? buildRoot.replace(/[A-Za-z]/g, letter => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase())
  : buildRoot;
await promoteBuild({ repoRoot, userConfig, buildId, buildRoot: requested, modes: ['code'] });
const current = getCurrentBuildInfo(repoRoot, userConfig);
assert.equal(current.buildId, buildId);
assert.equal(normalizeIdentityPath(current.buildRoot), normalizeIdentityPath(buildRoot));
if (process.platform === 'win32') {
  const publicationPath = resolveArtifactPublicationPath(buildRoot, 'code');
  const publication = JSON.parse(await fs.readFile(publicationPath, 'utf8'));
  const aliased = { ...publication, buildRoot: path.toNamespacedPath(publication.buildRoot),
    indexDir: path.toNamespacedPath(publication.indexDir) };
  await fs.writeFile(publicationPath, JSON.stringify(aliased));
  await assertArtifactPublicationReady({ buildRoot, modes: ['code'] });
  const foreign = path.join(dir, 'different-generation'); await fs.mkdir(foreign);
  for (const field of ['buildRoot', 'indexDir']) {
    await fs.writeFile(publicationPath, JSON.stringify({ ...aliased, [field]: path.toNamespacedPath(foreign) }));
    await assert.rejects(assertArtifactPublicationReady({ buildRoot, modes: ['code'] }), /record does not belong/);
  }
  await fs.writeFile(publicationPath, JSON.stringify(aliased));
}
console.log('Published generation accepts the platform path identity without creating filesystem links');
