import path from 'node:path';
import { resolveFileCaps } from './read.js';
import { detectBinary, isMinifiedName, readFileSample } from '../file-scan.js';

export async function resolvePreReadSkip({
  abs,
  fileEntry,
  fileStat,
  ext,
  fileCaps,
  fileScanner,
  runIo
}) {
  const capsByExt = resolveFileCaps(fileCaps, ext);
  if (capsByExt.maxBytes && fileStat.size > capsByExt.maxBytes) {
    return { reason: 'oversize', bytes: fileStat.size, maxBytes: capsByExt.maxBytes };
  }
  const scanState = typeof fileEntry === 'object' ? fileEntry.scan : null;
  if (scanState?.skip) {
    const { reason, ...extra } = scanState.skip;
    return { reason: reason || 'oversize', ...extra };
  }
  if (isMinifiedName(path.basename(abs))) {
    return { reason: 'minified', method: 'name' };
  }
  const knownLines = Number(fileEntry?.lines);
  if (capsByExt.maxLines && Number.isFinite(knownLines) && knownLines > capsByExt.maxLines) {
    return { reason: 'oversize', lines: knownLines, maxLines: capsByExt.maxLines };
  }
  if (!scanState?.checkedBinary || !scanState?.checkedMinified) {
    const scanResult = await runIo(() => fileScanner.scanFile({
      absPath: abs,
      stat: fileStat,
      ext,
      readSample: readFileSample
    }));
    if (scanResult?.skip) {
      const { reason, ...extra } = scanResult.skip;
      return { reason: reason || 'oversize', ...extra };
    }
  }
  return null;
}

export async function resolveBinarySkip({ abs, fileBuffer, fileScanner }) {
  if (!fileBuffer || !fileBuffer.length) return null;
  const binarySkip = await detectBinary({
    absPath: abs,
    buffer: fileBuffer,
    maxNonTextRatio: fileScanner.binary?.maxNonTextRatio ?? 0.3
  });
  if (!binarySkip) return null;
  const { reason, ...extra } = binarySkip;
  return { reason: reason || 'binary', ...extra };
}
