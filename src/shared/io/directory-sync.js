import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createContainedFileResource } from '../contained-file-resource.js';
import { observeStorageResource } from '../storage/failure-observation.js';

const UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EPERM']);
export const assertDirectoryIdentity = (stat, expected = stat) => {
  if (!stat.isDirectory() || !expected.isDirectory() || stat.dev !== expected.dev || stat.ino !== expected.ino
    || String(stat.birthtimeNs ?? stat.birthtimeMs) !== String(expected.birthtimeNs ?? expected.birthtimeMs)) throw Object.assign(
    new Error('Publication parent no longer identifies its admitted directory.'), { code: 'ERR_ATOMIC_PARENT_CHANGED' });
};
const failureCode = error => {
  const observation = observeStorageResource(error, { phase: 'parent-directory-sync' });
  observation.requireSettled(); let code;
  try { code = observation.primary.code; } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled(); return code;
};
export const syncParentDirectory = async (targetPath, { expectedParent = null, unsupportedCodes = UNSUPPORTED } = {}) => {
  const parent = path.dirname(targetPath);
  expectedParent ||= await fs.stat(parent, { bigint: true }); assertDirectoryIdentity(expectedParent);
  let phase = 'open';
  try {
    const handle = await fs.open(parent, 'r');
    const owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['sync'] });
    await owner.run(async descriptor => {
      phase = 'verify'; assertDirectoryIdentity(await descriptor.stat({ bigint: true }), expectedParent);
      phase = 'sync'; await descriptor.sync(); phase = 'verify';
      assertDirectoryIdentity(await descriptor.stat({ bigint: true }), expectedParent);
      assertDirectoryIdentity(await fs.stat(parent, { bigint: true }), expectedParent);
    });
  } catch (error) {
    if (!['open', 'sync'].includes(phase) || !unsupportedCodes.has(failureCode(error))) throw error;
  }
};
export const syncParentDirectorySync = (targetPath, { expectedParent = null, unsupportedCodes = UNSUPPORTED } = {}) => {
  const parent = path.dirname(targetPath);
  expectedParent ||= fsSync.statSync(parent, { bigint: true }); assertDirectoryIdentity(expectedParent);
  let phase = 'open';
  try {
    const methods = { receiver: fsSync, read: fsSync.readSync, stat: fsSync.fstatSync, close: fsSync.closeSync, sync: fsSync.fsyncSync };
    const fd = fsSync.openSync(parent, 'r');
    const owner = createContainedFileResource({ fd, sync: true, methods, additionalMethods: ['sync'] });
    owner.runSync(descriptor => {
      phase = 'verify'; assertDirectoryIdentity(descriptor.stat({ bigint: true }), expectedParent);
      phase = 'sync'; descriptor.sync(); phase = 'verify';
      assertDirectoryIdentity(descriptor.stat({ bigint: true }), expectedParent);
      assertDirectoryIdentity(fsSync.statSync(parent, { bigint: true }), expectedParent);
    });
  } catch (error) {
    if (!['open', 'sync'].includes(phase) || !unsupportedCodes.has(failureCode(error))) throw error;
  }
};
