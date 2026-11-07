import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText } from '../../../shared/io/atomic-write.js';
import { createContainedFileResource } from '../../../shared/contained-file-resource.js';
import { readBuildStateFailureCode } from './store-errors.js';

/** Own the actual directory descriptor before sync. Unsupported directory sync
 * is ordinary only after original operation/close observations are settled.
 */
const syncParentDirectory = async filePath => {
  try {
    const handle = await fs.open(path.dirname(filePath), 'r');
    const owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['sync'] });
    await owner.run(operations => operations.sync());
  } catch (error) {
    const code = readBuildStateFailureCode(error, 'build-state-parent-sync');
    if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(code)) throw error;
  }
};

/** One original descriptor owns append/write/sync/close; recovery never repeats
 * the write. A vanished selected root is not recreated by a later state patch.
 * Existing atomic publication remains the owner for non-append payloads.
 */
export const writeBuildStateText = async (filePath, text, { append = false, durable = false } = {}) => {
  if (!append) { await atomicWriteText(filePath, text, { newline: false, mkdir: false }); return; }
  let existedBefore = true;
  if (durable) {
    try { await fs.stat(filePath); }
    catch (error) {
      if (readBuildStateFailureCode(error, 'build-state-append-existence') !== 'ENOENT') throw error;
      existedBefore = false;
    }
  }
  const handle = await fs.open(filePath, 'a');
  const owner = createContainedFileResource({ handle, sync: false, additionalMethods: durable ? ['writeFile', 'sync'] : ['writeFile'] });
  await owner.run(async operations => {
    await operations.writeFile(text, 'utf8');
    if (durable) await operations.sync();
  });
  if (durable && !existedBefore) await syncParentDirectory(filePath);
};
