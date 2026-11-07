import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { throwIfAborted } from '../../../shared/abort.js';
import { describeStorageFailure } from '../../../shared/storage/failure-observation.js';
import { closeRuntimeResources } from './close-resources.js';
import { readRuntimeMemberBytes } from './verified-reads.js';
import { assertRuntimeDiskReserve, runtimeImportError } from './raw-store.js';
const CONTROL_LIMIT = 4096;
export const isMissingRuntimeMember = error => describeStorageFailure(error).code === 'ENOENT';

/** One bounded control replacement under the existing destination writer.
 * Its final physical inventory owns replaced-file credits: a rename alone
 * cannot prove the old inode lost every other retained hardlink. */
export const publishRuntimeControl = async ({ root, relativePath, bytes, account, diskReserveBytes,
  work, signal = null, check = () => throwIfAborted(signal), publicationState = null }) => {
  check();
  if (bytes.length > CONTROL_LIMIT) throw runtimeImportError('Runtime publication control exceeds its allowance.');
  let old = null;
  try { old = (await readRuntimeMemberBytes({ root, relativePath, maxBytes: CONTROL_LIMIT, signal })).buffer; }
  catch (error) { if (!isMissingRuntimeMember(error)) throw error; }
  check();
  if (old?.equals(bytes)) {
    if (publicationState) publicationState.pointerState = 'committed';
    return false;
  }
  const filename = path.join(root, relativePath), temporary = path.join(path.dirname(filename), '.current-' + randomUUID());
  await assertRuntimeDiskReserve({ destination: root, diskReserveBytes, additionalBytes: bytes.length });
  check(); account.reserve(bytes.length);
  let published = false, failed = false, failure;
  try {
    const handle = await fs.open(temporary, 'wx');
    let writeFailed = false, writeFailure;
    try {
      check(); await handle.writeFile(bytes); work.add('fileWriteBytes', bytes.length);
      check(); await handle.sync(); check();
    } catch (error) { writeFailed = true; writeFailure = error; throw error; }
    finally { await closeRuntimeResources([handle], writeFailure, { hasOperationError: writeFailed }); }
    check();
    if (publicationState) publicationState.pointerState = 'commit-unconfirmed';
    await fs.rename(temporary, filename); published = true;
    if (publicationState) publicationState.pointerState = 'committed';
    check(); return true;
  } catch (error) { failed = true; failure = error; throw error; }
  finally {
    await closeRuntimeResources([{ close: async () => {
      await fs.rm(temporary, { force: true });
      if (!published) account.release(bytes.length);
    } }], failure, { hasOperationError: failed });
  }
};

