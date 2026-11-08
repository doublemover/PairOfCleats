import fs from 'node:fs/promises';
import path from 'node:path';
import { removeSqliteSidecars } from '../../utils.js';
import { getSqliteStorageOperation } from '../storage-operation.js';
import { observeStorageResource, describeStorageFailure } from '../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';

/** Readiness requires the actual output observation. Unknown/unreadable size
 * cannot be published as a measured zero after a successful native update. */
export const readSqliteOutputBytes = async outputPath => {
  let original;
  try {
    const stat = await fs.stat(outputPath);
    original = observeStorageResource(stat, { phase: 'sqlite-output-stat' }); original.requireSettled();
    const size = stat.size;
    if (!Number.isSafeInteger(size) || size < 0 || !stat.isFile()) throw Object.assign(
      new Error('SQLite output requires a regular file with a measured nonnegative safe byte count.'), { code: 'ERR_SQLITE_OUTPUT_STAT' });
    original.requireSettled(); return size;
  } catch (error) {
    const failure = original?.hasResourceObservation ? original.wrap(error) : error;
    getSqliteStorageOperation()?.retainFailure(failure); throw failure;
  }
};

/** Retire only the actual failed attempt's staging family. Pending original
 * work or main unlink cannot admit sidecar removal. This grants no root GC. */
export const cleanupFailedSqliteStaging = async (staged, primary) => {
  const retain = secondary => {
    getSqliteStorageOperation()?.retainFailure(secondary);
    return addStorageFailureContext(primary, {}, secondary, { secondaryPresent: true, forceAggregate: true });
  };
  try { observeStorageResource(primary, { phase: 'sqlite-staging-original-work' }).requireSettled(); }
  catch (pending) { return retain(pending); }
  if (!staged) return primary;
  try {
    if (typeof staged !== 'string' || !path.isAbsolute(staged)) throw new TypeError('SQLite staging cleanup requires its actual absolute attempt path.');
    getSqliteStorageOperation()?.admitTargets([staged]);
    const removed = await fs.rm(staged, { force: true });
    observeStorageResource(removed, { phase: 'sqlite-staging-main-removal' }).requireSettled();
  } catch (cleanup) {
    getSqliteStorageOperation()?.retainFailure(cleanup);
    let diagnostic;
    try { diagnostic = describeStorageFailure(cleanup, { phase: 'sqlite-staging-main-removal' }); }
    catch (pending) { return retain(pending); }
    if (!['ENOENT', 'ENOTDIR'].includes(diagnostic.code)) return retain(cleanup);
  }
  try { await removeSqliteSidecars(staged); }
  catch (cleanup) { return retain(cleanup); }
  return primary;
};
