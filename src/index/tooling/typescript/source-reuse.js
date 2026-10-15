import { createHash } from 'node:crypto';
import { getTypeScriptLoadReceipt } from './load.js';

const digest = value => createHash('sha256').update(value).digest('hex');
/** Build-owned, byte-bounded handoff of unbound preflight ASTs to the one normal
 * Program. Consumed entries never retain checker/symbol arenas for a later build.
 */
export const createCompilerSourceReuse = ({ maxBytes = 16 * 1024 * 1024 } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('Invalid compiler source reuse allowance.');
  const entries = new Map(), prepared = new Set(), reused = new Set(), recomputed = new Set();
  let retainedBytes = 0, peakRetainedBytes = 0, sourceBytesReused = 0;
  const identity = ({ ts, filename, text, languageVersion, scriptKind, options, mapping }) => digest(JSON.stringify({
    compiler: getTypeScriptLoadReceipt(ts) || { version: ts.version }, filename, sourceHash: digest(text),
    languageVersion: { languageVersion: typeof languageVersion === 'number' ? languageVersion : languageVersion.languageVersion,
      impliedNodeFormat: languageVersion?.impliedNodeFormat ?? null, jsDocParsingMode: languageVersion?.jsDocParsingMode ?? ts.JSDocParsingMode.ParseAll },
    scriptKind, options, mapping
  }, (key, value) => key === 'configFile' && value?.text ? { fileName: value.fileName, textHash: digest(value.text) } : value));
  const remove = key => {
    const row = entries.get(key);
    if (row) { retainedBytes -= row.charge; entries.delete(key); }
    return row;
  };
  return {
    identity,
    get(key, filename, mode) {
      const row = entries.get(key); if (!row) return null;
      if (mode === 'consume') {
        remove(key); reused.add(filename); sourceBytesReused += row.sourceBytes;
      }
      return row.sourceFile;
    },
    put(key, filename, sourceFile, mode) {
      if (mode !== 'prepare') { recomputed.add(filename); return; }
      prepared.add(filename);
      const sourceBytes = Buffer.byteLength(sourceFile.text);
      const charge = Math.max(4096, sourceBytes * 16) + Buffer.byteLength(filename) + Buffer.byteLength(key);
      if (!Number.isSafeInteger(charge) || charge > maxBytes) return;
      remove(key);
      while (retainedBytes + charge > maxBytes && entries.size) remove(entries.keys().next().value);
      entries.set(key, { sourceFile, sourceBytes, charge }); retainedBytes += charge;
      peakRetainedBytes = Math.max(peakRetainedBytes, retainedBytes);
    },
    clear() { entries.clear(); retainedBytes = 0; },
    snapshot() { return { preparedFiles: [...prepared].sort(), parseReusedFiles: [...reused].sort(),
      parsedFiles: [...recomputed].sort(), sourceBytesReused, peakRetainedBytes,
      retainedByteBasis: 'source-bytes-times-16-estimate', maxRetainedBytes: maxBytes }; }
  };
};
