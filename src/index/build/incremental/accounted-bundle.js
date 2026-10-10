import fs from 'node:fs/promises';
import path from 'node:path';
import { writeBundleFile } from '../../../shared/bundle-io.js';
import { withSemanticDiskWriter } from '../../semantic/disk-writes.js';
export { withSemanticDiskWriter } from '../../semantic/disk-writes.js';
const size = async (filename, replacing = false) => {
  try {
    const stat = await fs.stat(filename);
    return replacing && stat.nlink > 1 ? 0 : stat.size;
  }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
};

/** Reserve the full temporary encoding while the previous snapshot still
 * exists. Serialize same-name writes on the shared build account so concurrent
 * retries cannot each return the same old snapshot's credit.
 */
export const writeAccountedBundle = async ({ diskAccount, ...options }) => {
  if (!diskAccount) return writeBundleFile(options);
  const key = path.resolve(options.bundlePath);
  return withSemanticDiskWriter(diskAccount, key, async () => {
    const oldBytes = await size(key, true) + await size(key + '.checksum.json', true);
    const reservation = Buffer.byteLength(JSON.stringify(options.bundle)) * 2 + 65536;
    diskAccount.reserve(reservation);
    // A failed write may have left complete or temporary bytes behind. Keep
    // its conservative credit until the next physical inventory reconciliation.
    const result = await writeBundleFile(options);
    const actualBytes = await size(key) + await size(key + '.checksum.json');
    if (actualBytes > reservation) diskAccount.reserve(actualBytes - reservation);
    diskAccount.release(oldBytes + Math.max(0, reservation - actualBytes));
    return result;
  });
};
