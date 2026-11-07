import { normalizeFilePath } from '../utils.js';
import { throwIfAborted } from '../../../shared/abort.js';

/** Snapshot headers bind immutable modern bundles; every ingestion route also
 * binds emitted chunk paths, including supported legacy bundles without an
 * inventory. Optional declared headers cannot contradict their selected input.
 */
export const matchesSqliteBundleSource = ({ bundle, file, entry, index = null, count = null, signal = null }) => {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) || !Array.isArray(bundle.chunks)) return false;
  const expected = normalizeFilePath(file);
  if (!expected) return false;
  const sameFile = value => typeof value === 'string' && normalizeFilePath(value) === expected;
  if (bundle.file != null && !sameFile(bundle.file)) return false;
  if (bundle.hash != null && entry?.hash != null && bundle.hash !== entry.hash) return false;
  if (bundle.size != null && entry?.size != null && bundle.size !== entry.size) return false;
  if (index != null && bundle.bundleShardIndex != null && bundle.bundleShardIndex !== index) return false;
  if (count != null && bundle.bundleShardCount != null && bundle.bundleShardCount !== count) return false;
  for (let position = 0; position < bundle.chunks.length; position++) {
    if (position % 256 === 0) throwIfAborted(signal);
    const chunk = bundle.chunks[position];
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk) || (chunk.file != null && !sameFile(chunk.file))) return false;
  }
  return true;
};
