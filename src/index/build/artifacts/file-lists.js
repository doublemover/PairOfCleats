import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonArrayFile, writeJsonObjectFile } from '../../../shared/json-stream.js';

export async function writeFileLists({ outDir, state, userConfig, log }) {
  if (outDir) {
    await fs.mkdir(outDir, { recursive: true });
  }
  const fileListConfig = userConfig?.indexing || {};
  const debugFileLists = fileListConfig.debugFileLists === true;
  const sampleSize = Number.isFinite(Number(fileListConfig.fileListSampleSize))
    ? Math.max(0, Math.floor(Number(fileListConfig.fileListSampleSize)))
    : 50;
  const sampleList = (list) => {
    if (!Array.isArray(list) || sampleSize <= 0) return [];
    if (list.length <= sampleSize) return list.slice();
    return list.slice(0, sampleSize);
  };
  const fileListSummary = {
    generatedAt: new Date().toISOString(),
    scanned: {
      count: state.scannedFilesTimes.length,
      sample: sampleList(state.scannedFilesTimes)
    },
    skipped: {
      count: state.skippedFiles.length,
      sample: sampleList(state.skippedFiles)
    }
  };
  const fileListPath = path.join(outDir, '.filelists.json');
  await writeJsonObjectFile(fileListPath, { fields: fileListSummary, atomic: true });
  if (debugFileLists) {
    await writeJsonArrayFile(
      path.join(outDir, '.scannedfiles.json'),
      state.scannedFilesTimes,
      { atomic: true }
    );
    await writeJsonArrayFile(
      path.join(outDir, '.skippedfiles.json'),
      state.skippedFiles,
      { atomic: true }
    );
    log('→ Wrote .filelists.json, .scannedfiles.json, and .skippedfiles.json');
  } else {
    log('→ Wrote .filelists.json (samples only).');
  }
  return { fileListPath };
}
