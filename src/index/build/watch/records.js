import { normalizeRoot } from './shared.js';
import { isWithinRoot, toRealPathSync } from '../../../workspace/identity.js';
import { sampleRecordContent } from '../record-sample.js';
import { readFileSample } from '../file-scan.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';

export const resolveRecordsRoot = (root, recordsDir) => {
  if (!recordsDir) return null;
  const normalizedRecords = normalizeRoot(recordsDir);
  const canonicalRoot = toRealPathSync(root);
  const canonicalRecords = toRealPathSync(recordsDir);
  if (!isWithinRoot(canonicalRecords, canonicalRoot)) return null;
  return normalizedRecords;
};

export const readRecordSample = async (absPath, maxBytes) => {
  try {
    return (await sampleRecordContent({ maxBytes,
      readSample: bytes => readFileSample(absPath, bytes) })).text;
  } catch (error) {
    observeStorageResource(error, { phase: 'watch-record-sample' }).requireSettled();
    return '';
  }
};
