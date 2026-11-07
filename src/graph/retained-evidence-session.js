import { openJsonlRowReader } from '../shared/artifact-io/offsets.js';
import { resolveManifestPath } from '../shared/artifact-io/manifest-paths.js';
import { throwIfAborted } from '../shared/abort.js';

const totals = ['sourceOpens', 'physicalReadCalls', 'physicalReadBytes', 'fileHashAttempts',
  'filesHashed', 'bytesHashed', 'offsetEntriesValidated', 'dataBlocksVerified',
  'offsetBlocksVerified', 'blockBytesVerified', 'rowReadWindows', 'rowsDecoded'];
const peaks = ['peakDecodedWindowBytes', 'peakRetainedProofBytes', 'peakDescriptorUpperBound'];

/** One serial enumeration owns at most one exact verified piece/offset pair.
 * No pathname, cursor or metadata cache grants reuse to another operation.
 * Failed close is terminal; only the original descriptor owner can recover it.
 */
export const createRetainedEvidenceSession = indexDir => {
  const completed = Object.fromEntries([...totals, ...peaks].map(key => [key, 0]));
  let reader = null, part = null, closing = null, closed = false, activeRead = null, completion = null;
  const getDiagnostics = () => {
    const current = reader?.getDiagnostics();
    return Object.freeze({ ...Object.fromEntries(totals.map(key => [key, completed[key] + (current?.[key] ?? 0)])),
      ...Object.fromEntries(peaks.map(key => [key, Math.max(completed[key], current?.[key] ?? 0)])),
      retainedProofBytes: current?.retainedProofBytes ?? 0,
      retainedDescriptorUpperBound: current?.retainedDescriptorUpperBound ?? 0 });
  };
  const releasePiece = () => {
    if (!reader) return Promise.resolve();
    if (!closing) closing = (async () => {
      await reader.close();
      const observation = reader.getDiagnostics();
      for (const key of totals) completed[key] += observation[key];
      for (const key of peaks) completed[key] = Math.max(completed[key], observation[key]);
      reader = null; part = null;
    })();
    return closing;
  };
  const readRows = async (selected, partIndex, indexes, options) => {
    throwIfAborted(options.signal);
    if (closed) throw new Error('Retained evidence enumeration is closed.');
    if (part !== partIndex) {
      await releasePiece();
      throwIfAborted(options.signal);
      if (closed) throw new Error('Retained evidence enumeration is closed.');
      closing = null;
      const { piece, offsets, dataHash, offsetsHash } = selected;
      reader = await openJsonlRowReader(resolveManifestPath(indexDir, piece.path, true),
        resolveManifestPath(indexDir, offsets.path, true), { containedRoot: indexDir });
      part = partIndex;
      await reader.verify({ jsonlBytes: piece.bytes, offsetsBytes: offsets.bytes,
        jsonlHash: dataHash.value, offsetsHash: offsetsHash.value,
        jsonlHashAlgorithm: dataHash.algorithm, offsetsHashAlgorithm: offsetsHash.algorithm, signal: options.signal });
      await reader.validateOffsets({ signal: options.signal });
    }
    return reader.readRows(indexes, options);
  };
  return {
    getDiagnostics,
    releasePiece,
    readRows(...args) {
      if (activeRead) throw new Error('Retained evidence enumeration only admits one read window.');
      activeRead = readRows(...args);
      const original = activeRead;
      original.then(() => { if (activeRead === original) activeRead = null; },
        () => { if (activeRead === original) activeRead = null; });
      return original;
    },
    close() {
      closed = true;
      if (!completion) completion = (async () => {
        if (activeRead) await Promise.allSettled([activeRead]);
        await releasePiece();
      })();
      return completion;
    }
  };
};
