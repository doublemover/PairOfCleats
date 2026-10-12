import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from './versioning.js';

/**
 * Exact format gate. Call before consuming an index component, including cached
 * envelopes. External runtime capture formats do not use this gate.
 */
export const assertCurrentIndexFormat = ({
  operation, component, foundVersion, expectedVersion = ARTIFACT_SURFACE_VERSION,
  repoRoot, indexPath
}) => {
  if (foundVersion === expectedVersion) return;
  if (!operation || !component || !repoRoot || !indexPath) {
    throw new TypeError('Format validation requires operation, component, repoRoot and indexPath.');
  }
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedIndex = path.resolve(indexPath);
  const found = foundVersion == null ? 'missing' : foundVersion;
  const rebuildCommand = 'pairofcleats index build --repo "' + resolvedRoot + '" --mode all';
  const details = {
    operation, component, expectedVersion, foundVersion: found,
    repoRoot: resolvedRoot, indexPath: resolvedIndex, rebuildCommand
  };
  const error = new Error(
    'ERR_INDEX_FORMAT_UNSUPPORTED: Cannot read ' + component + ' at ' + resolvedIndex + '.\n'
    + 'Repository: ' + resolvedRoot + '\n'
    + 'Expected format/schema: ' + expectedVersion + '; found: ' + String(found) + '.\n'
    + 'Rebuild from source:\n' + rebuildCommand + '\n'
    + 'The existing index and source files have not been changed.'
  );
  error.code = 'ERR_INDEX_FORMAT_UNSUPPORTED';
  error.details = details;
  Object.assign(error, details);
  throw error;
};
