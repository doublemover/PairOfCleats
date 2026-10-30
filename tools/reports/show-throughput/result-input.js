import path from 'node:path';
import { TextDecoder } from 'node:util';
import { setImmediate } from 'node:timers/promises';
import { withStorageDirectory } from '../../../src/shared/storage/directory.js';
import { assertNoSymlinkPath, readVerifiedContainedFileSync } from '../../../src/shared/contained-file.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { classifyThroughputInput, THROUGHPUT_INPUT_VERSION } from './result-contract.js';
import { selectThroughputRunInputs } from './selection.js';
import { resolveRepoIdentity, resolveRepoHistoryKey } from './run-identity.js';

export const THROUGHPUT_INPUT_LIMITS = Object.freeze({ fileBytes: 32 * 1024 * 1024,
  readBytes: 512 * 1024 * 1024, retainedBytes: 128 * 1024 * 1024, metadataBytes: 8 * 1024 * 1024, files: 10000 });
const fail = (state, code) => ({ state, cause: { code: typeof code === 'string' ? code.slice(0, 128) : null } });

/** Sequential bounded metadata admission, followed by exact selected-file reads.
 * Metadata never retains parsed payload bodies. Encoded-byte allowances are
 * explicit and conservative; they are not a JavaScript heap/RSS measurement. */
export const createThroughputInputSession = ({ signal = null, limits = {}, listenForSignals = false } = {}) => {
  const bounds = { ...THROUGHPUT_INPUT_LIMITS, ...limits };
  for (const [key, maximum] of Object.entries(THROUGHPUT_INPUT_LIMITS)) {
    if (!Number.isSafeInteger(bounds[key]) || bounds[key] < 1 || bounds[key] > maximum) throw new TypeError('Private input limits may only lower the fixed allowances.');
  }
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (listenForSignals) { process.on('SIGINT', cancel); process.on('SIGTERM', cancel); }
  const cancelled = () => abort.signal.aborted || signal?.aborted === true;
  const folders = [], receipts = new Map();
  let discovered = 0, readAllowance = 0, observedReadBytes = 0, retainedBytes = 0, metadataBytes = 0, inventoryIncomplete = false;
  const checkpoint = async () => { await setImmediate(); return !cancelled(); };
  const read = (root, file, expected = null) => {
    const remaining = bounds.readBytes - readAllowance;
    if (remaining < 1) return fail('budget-exhausted', 'ERR_THROUGHPUT_READ_BUDGET');
    const allowance = Math.min(bounds.fileBytes, remaining);
    // Failed native reads cannot establish their actual read extent. Reserve
    // their entire admitted allowance rather than reporting invented zero I/O.
    readAllowance += allowance;
    let value;
    try {
      value = readVerifiedContainedFileSync(root, file, { maxBytes: allowance,
        ...(expected ? { expectedBytes: expected.bytes, expectedHash: expected.sha256.slice(7), expectedFileIdentity: expected.fileIdentity } : {}) });
    } catch (error) {
      observeStorageResource(error, { phase: 'throughput-result-input-read' }).requireSettled();
      const state = error.code === 'ENOENT' ? 'missing' : expected ? 'changed-or-unreadable'
        : error.code === 'ERR_FILE_TOO_LARGE' ? allowance < bounds.fileBytes ? 'budget-exhausted' : 'too-large' : 'unreadable';
      return fail(state, error.code);
    }
    readAllowance -= allowance - value.buffer.length;
    observedReadBytes += value.buffer.length;
    const source = { bytes: value.buffer.length, sha256: 'sha256:' + value.hash };
    Object.defineProperty(source, 'fileIdentity', { value: value.fileIdentity });
    try {
      const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value.buffer));
      return { state: classifyThroughputInput(payload), source, payload };
    } catch { return { ...fail('malformed', 'ERR_THROUGHPUT_JSON'), source }; }
  };
  return {
    checkpoint,
    lastInventoryStatus() { const folder = folders.at(-1); return { discovered: folder?.files.length || 0, complete: folder?.inventoryComplete === true }; },
    async *folder(folderPath, { repoFilter = null, latestCount = null, afterInventory } = {}) {
      const folder = { path: folderPath, files: [], inventoryComplete: true };
      folders.push(folder);
      try {
        assertNoSymlinkPath(path.dirname(folderPath), folderPath);
        await withStorageDirectory(folderPath, async directory => {
          for (;;) {
            if (!await checkpoint()) { inventoryIncomplete = true; folder.inventoryComplete = false; break; }
            const entry = await directory.read();
            if (!entry) break;
            if (!entry.name.endsWith('.json')) continue;
            if (discovered >= bounds.files) { inventoryIncomplete = true; folder.inventoryComplete = false; break; }
            discovered++;
            const filePath = path.join(folderPath, entry.name), result = read(folderPath, filePath);
            const row = { file: entry.name, path: filePath, state: result.state, source: result.source || null,
              cause: result.cause || null, selected: false, admitted: false, processed: false };
            if (result.state === 'supported-run' && [result.payload.repo?.root, result.payload.artifacts?.repo?.root, result.payload.artifacts?.repo?.cacheRoot]
              .some(value => typeof value === 'string' && value.length > 32768)) row.state = 'unsupported-envelope';
            if (row.state === 'supported-run') {
              row.repoIdentity = resolveRepoIdentity({ payload: result.payload, file: entry.name });
              row.repoHistoryKey = resolveRepoHistoryKey({ payload: result.payload, file: entry.name });
              const stamp = result.payload.generatedAt || result.payload.summary?.generatedAt;
              const timestamp = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
              row.generatedAtMs = Number.isFinite(timestamp) ? timestamp : null;
              row.inputKind = 'supported-run';
            }
            const metadataSize = Buffer.byteLength(JSON.stringify(row));
            if (metadataBytes + metadataSize > bounds.metadataBytes) {
              folder.stop = { file: entry.name, ...fail('budget-exhausted', 'ERR_THROUGHPUT_METADATA_BUDGET') };
              inventoryIncomplete = true; folder.inventoryComplete = false; break;
            }
            metadataBytes += metadataSize;
            folder.files.push(row); receipts.set(filePath, row);
          }
        });
      } catch (error) {
        observeStorageResource(error, { phase: 'throughput-result-inventory' }).requireSettled();
        folder.inventoryComplete = false; inventoryIncomplete = true;
        folder.cause = fail('unreadable-inventory', error.code).cause;
      }
      const selected = selectThroughputRunInputs(folder.files, { repoFilter, latestCount });
      for (const row of selected) row.selected = true;
      await afterInventory?.(selected.map(row => ({ file: row.file, path: row.path })));
      for (const row of selected) {
        if (!await checkpoint()) { row.state = 'cancelled'; continue; }
        if (retainedBytes + row.source.bytes > bounds.retainedBytes) { Object.assign(row, fail('budget-exhausted', 'ERR_THROUGHPUT_RETAINED_BUDGET')); continue; }
        const result = read(folderPath, row.path, row.source);
        if (result.state !== 'supported-run') { row.state = result.state; row.cause = result.cause || null; continue; }
        row.admitted = true; retainedBytes += result.source.bytes;
        yield { file: row.file, path: row.path, payload: result.payload, source: result.source };
      }
    },
    processed(file) { const row = receipts.get(file); if (!row?.admitted) throw new Error('Cannot process an unadmitted result input.'); row.processed = true; },
    snapshot() {
      const files = folders.flatMap(folder => folder.files);
      const selected = files.filter(file => file.selected).length, admitted = files.filter(file => file.admitted).length;
      const processed = files.filter(file => file.processed).length;
      const failures = files.filter(file => !['supported-run', 'recognized-non-run'].includes(file.state)).length
        + folders.filter(folder => folder.stop || folder.cause).length;
      const complete = !cancelled() && !inventoryIncomplete && failures === 0 && processed === selected;
      return { version: THROUGHPUT_INPUT_VERSION, scope: 'selected-result-file-cohort', state: complete ? processed ? 'complete' : 'empty' : 'partial', complete,
        cancelled: cancelled(), inventoryComplete: !inventoryIncomplete, discovered, selected, admitted, processed, failures,
        excluded: files.filter(file => !file.selected && ['supported-run', 'recognized-non-run'].includes(file.state)).length,
        budget: { limits: bounds, observedReadBytes, readAllowanceConsumed: readAllowance, retainedPayloadBytes: retainedBytes, retainedMetadataBytes: metadataBytes },
        folders: folders.map(folder => ({ ...folder, files: folder.files.map(({ inputKind, source, ...row }) => ({ ...row,
          source: source ? { bytes: source.bytes, sha256: source.sha256 } : null })) })) };
    },
    close() { if (listenForSignals) { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); } }
  };
};
