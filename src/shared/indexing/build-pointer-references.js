import path from 'node:path';
import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import { readVerifiedContainedFile } from '../contained-file.js';
import { addStorageFailureContext } from '../storage/operation-error.js';
import { describeStorageFailure } from '../storage/failure-observation.js';
import { resolveCurrentBuildRoots, resolveCacheScopedBuildPointerRoot, sameIdentityPath } from './build-pointer-roots.js';

/** A bounded reference snapshot for the existing maintenance owner. Callers
 * retain their cache exclusion and re-read before mutation; this is no deletion
 * capability. Resolution and format admission share the normal pointer owners.
 */
export const readCurrentBuildReferences = async ({ repoRoot, repoCacheRoot, buildsRoot }) => {
  if (!sameIdentityPath(path.join(repoCacheRoot, 'builds'), buildsRoot)) throw new TypeError('Build references require the canonical builds namespace.');
  const currentPath = path.join(buildsRoot, 'current.json');
  let source;
  try { source = await readVerifiedContainedFile(repoCacheRoot, currentPath, { maxBytes: 512 * 1024, hashAlgorithm: 'sha256' }); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'watch-retention-pointer-read' }).code === 'ENOENT') return { roots: [], absent: true };
    throw error;
  }
  try {
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.buffer));
    assertCurrentIndexFormat({ operation: 'read', component: 'build pointer',
      foundVersion: data?.artifactSurfaceVersion, repoRoot, indexPath: currentPath });
    const { validateArtifact } = await import('../../contracts/validators/artifacts.js');
    const validation = validateArtifact('builds_current', data);
    if (!validation.ok) throw new Error(validation.errors.slice(0, 5).join('; '));
    const selected = resolveCurrentBuildRoots(data, { repoCacheRoot, buildsRoot });
    if (!selected.buildId || !selected.activeRoot) throw new Error('Current generation has no qualified active root.');
    const roots = new Set();
    const add = value => {
      if (roots.size >= 1024) throw new Error('Build reference inventory exceeds its maintenance bound.');
      const root = resolveCacheScopedBuildPointerRoot(value, repoCacheRoot, buildsRoot);
      if (!root) throw new Error('Build reference is outside the selected repository namespace.');
      roots.add(root);
    };
    add(data.buildRoot);
    for (const field of ['buildRoots', 'buildRootsByMode', 'buildRootsByStage']) {
      for (const value of Object.values(data[field] || {})) add(value);
    }
    return { roots: Object.freeze([...roots]), absent: false, sha256: source.hash, identity: source.fileIdentity };
  } catch (error) {
    throw addStorageFailureContext(new Error('Cannot establish published roots for watch retention.', { cause: error }),
      { code: 'ERR_WATCH_RETENTION_REFERENCES' }, error, { secondaryPresent: true });
  }
};
