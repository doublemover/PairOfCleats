import fs from 'node:fs/promises';
import { constants as bufferConstants } from 'node:buffer';
import { createContainedFileResource } from '../contained-file-resource.js';
export { getContainedFileSession } from '../contained-file-resource.js';

/** Read only the already-published owner's sealed byte extent. The caller
 * retains physical pathname authority; this existing descriptor owner grants
 * no removal or category authority and never replays reads during recovery.
 */
export const readFileLockReleaseInfo = async (lockPath, { expectedBytes, verifyStat }) => {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > bufferConstants.MAX_LENGTH
    || typeof verifyStat !== 'function') throw new TypeError('Lock release requires its bounded original byte/stat identity.');
  const open = fs.open, handle = await open.call(fs, lockPath, 'r');
  const owner = createContainedFileResource({ handle, sync: false });
  const buffer = await owner.run(async descriptor => {
    verifyStat(await descriptor.stat({ bigint: true }));
    const bytes = Buffer.allocUnsafe(expectedBytes);
    let position = 0;
    while (position < expectedBytes) {
      const count = Math.min(65536, expectedBytes - position);
      const { bytesRead } = await descriptor.read(bytes, position, count, position);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > count) {
        throw new Error('Published lock metadata read did not complete its sealed byte extent.');
      }
      position += bytesRead;
    }
    verifyStat(await descriptor.stat({ bigint: true }));
    return bytes;
  });
  const info = JSON.parse(buffer.toString('utf8'));
  return info && typeof info === 'object' && !Array.isArray(info) ? info : null;
};
