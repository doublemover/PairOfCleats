import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readVerifiedContainedFile, assertNoSymlinkPath, withContainedFile } from '../../shared/contained-file.js';
import { atomicWriteText } from '../../shared/io/atomic-write.js';
import { withFileLock } from '../../shared/locks/file-lock.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { throwIfAborted } from '../../shared/abort.js';
import { stableStringify } from '../../shared/stable-json.js';
import { renderRecordMarkdown } from './render.js';
import { resolveRecordArtifactPathSafe } from './record-paths.js';
import { TRIAGE_PUBLICATION_FIELD, TRIAGE_GENERATION_DIRECTORY, TRIAGE_RENDERER_VERSION,
  TRIAGE_PUBLICATION_LIMITS } from '../../contracts/triage-record-publication.js';
import { assertTriagePublicationReceipt as assertReceipt } from '../../contracts/validators/triage-record-publication.js';

export { TRIAGE_PUBLICATION_FIELD, TRIAGE_GENERATION_DIRECTORY, TRIAGE_RENDERER_VERSION };
const JSON_MAX_BYTES = TRIAGE_PUBLICATION_LIMITS.jsonBytes, MARKDOWN_MAX_BYTES = TRIAGE_PUBLICATION_LIMITS.markdownBytes;
const OWNER_BYTES = '{"schemaVersion":1,"owner":"triage-record-publication"}\n';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const invalid = (message, cause) => Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
  code: 'ERR_TRIAGE_RECORD_PUBLICATION'
});
const recordKey = id => sha256(process.platform === 'win32' ? id.toLowerCase() : id);
const decode = buffer => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
const recordContent = value => {
  const copy = { ...value }; delete copy[TRIAGE_PUBLICATION_FIELD]; return copy;
};
const pathsFor = (root, id, generation) => {
  const directory = path.join(root, TRIAGE_GENERATION_DIRECTORY, recordKey(id), generation);
  return { directory, jsonPath: path.join(directory, 'record.json'), mdPath: path.join(directory, 'record.md') };
};

/** This marker discriminates the reserved producer namespace only. It grants
 * no deletion authority or authority over a different selected records root.
 */
export const hasTriagePublicationNamespace = async (root, { signal = null } = {}) => {
  const directory = path.join(root, TRIAGE_GENERATION_DIRECTORY);
  try { assertNoSymlinkPath(root, directory); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'triage-publication-namespace' }).code === 'ENOENT') return false;
    throw error;
  }
  await readVerifiedContainedFile(root, path.join(directory, '.publication-owner.json'), {
    maxBytes: 1024, expectedBytes: Buffer.byteLength(OWNER_BYTES), expectedHash: sha256(OWNER_BYTES), signal
  });
  return true;
};

const ensurePublicationNamespace = async (root, signal) => {
  try { if (await hasTriagePublicationNamespace(root, { signal })) return; }
  catch (error) {
    // A first producer may still own marker publication. Join its existing
    // initialization lock; an unmarked foreign directory remains unadoptable.
    if (describeStorageFailure(error, { phase: 'triage-publication-namespace-admission' }).code !== 'ENOENT') throw error;
  }
  const initLock = path.join(root, '.record-publication-init.lock');
  assertNoSymlinkPath(root, initLock, { allowMissing: true });
  await withFileLock({ lockPath: initLock, signal, waitMs: 5000, pollMs: 20, timeoutBehavior: 'throw',
    metadata: { scope: 'triage-publication-namespace' } }, async () => {
    const directory = path.join(root, TRIAGE_GENERATION_DIRECTORY);
    assertNoSymlinkPath(root, directory, { allowMissing: true });
    let created = false;
    try { await fs.mkdir(directory); created = true; }
    catch (error) { if (describeStorageFailure(error, { phase: 'triage-publication-mkdir' }).code !== 'EEXIST') throw error; }
    if (created) await atomicWriteText(path.join(directory, '.publication-owner.json'), OWNER_BYTES, { mkdir: false, signal });
    await hasTriagePublicationNamespace(root, { signal });
  });
};

/** Cheap protocol discrimination for inventory only. An arbitrary JSON-only
 * legacy file was never a Markdown input. This prefix grants no publication
 * authority: a positive result still requires the complete strict reader below.
 */
export const requiresTriagePublicationRead = async (recordsDir, jsonPath, { signal = null, namespacePresent = false } = {}) => {
  throwIfAborted(signal);
  let header = false;
  try {
    header = await withContainedFile(recordsDir, jsonPath, async descriptor => {
      const prefix = Buffer.alloc(128);
      const { bytesRead } = await descriptor.read(prefix, 0, prefix.length, 0);
      throwIfAborted(signal); descriptor.verify();
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > prefix.length) throw invalid('Invalid publication-header read progress.');
      return prefix.subarray(0, bytesRead).toString('utf8').includes('"' + TRIAGE_PUBLICATION_FIELD + '"');
    });
  } catch (error) {
    if (describeStorageFailure(error, { phase: 'triage-publication-header' }).code !== 'ENOENT') throw error;
  }
  if (header || !namespacePresent) return header;
  // A changed/missing/reordered selector for an already-owned ID must not
  // downgrade into legacy mixed-pair admission or silently disappear.
  const directory = path.join(recordsDir, TRIAGE_GENERATION_DIRECTORY, recordKey(path.basename(jsonPath, '.json')));
  try { assertNoSymlinkPath(recordsDir, directory); return (await fs.lstat(directory)).isDirectory(); }
  catch (error) {
    if (describeStorageFailure(error, { phase: 'triage-record-generation-presence' }).code === 'ENOENT') return false;
    throw error;
  }
};

/** Capture one canonical JSON descriptor, then follow only the exact original
 * immutable generation selected by its strict receipt. No caller-supplied path
 * or marker grants authority; every payload remains inside the selected root.
 */
export const readTriagePublication = async (recordsDir, jsonPath, { signal = null, optional = false } = {}) => {
  let selected;
  try { selected = await readVerifiedContainedFile(recordsDir, jsonPath, { maxBytes: JSON_MAX_BYTES, signal }); }
  catch (error) {
    if (optional && describeStorageFailure(error, { phase: 'triage-publication-selection' }).code === 'ENOENT') return null;
    throw error;
  }
  let record;
  try { record = JSON.parse(decode(selected.buffer)); }
  catch (cause) { throw invalid('Malformed triage publication JSON.', cause); }
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw invalid('Triage record must be a JSON object.');
  const receipt = record[TRIAGE_PUBLICATION_FIELD];
  if (receipt === undefined) return { record, selected, publication: null };
  assertReceipt(receipt, record);
  if (!await hasTriagePublicationNamespace(recordsDir, { signal })) throw invalid('Triage selector lacks its original publication namespace.');
  const expectedPath = resolveRecordArtifactPathSafe(recordsDir, record.recordId, '.json');
  const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (!expectedPath || key(expectedPath) !== key(jsonPath)) throw invalid('Triage publication belongs to another record selection.');
  const generation = pathsFor(recordsDir, record.recordId, receipt.generation);
  // The immutable record and selector have exactly the same wire bytes. Even a
  // valid record receipt cannot borrow another JSON snapshot's Markdown input.
  await readVerifiedContainedFile(recordsDir, generation.jsonPath, { maxBytes: JSON_MAX_BYTES,
    expectedHash: sha256(selected.buffer), expectedBytes: selected.buffer.length, signal });
  const markdown = await readVerifiedContainedFile(recordsDir, generation.mdPath, { maxBytes: MARKDOWN_MAX_BYTES,
    expectedHash: receipt.markdownHash, expectedBytes: receipt.markdownBytes, signal });
  const text = decode(markdown.buffer);
  if (text !== renderRecordMarkdown(recordContent(record))) throw invalid('Triage Markdown differs from its selected canonical record.');
  return { record, selected, publication: Object.freeze({ ...receipt }), ...generation, text };
};

/** Constant-size snapshot witness for the later build admission. Do not retain
 * one full record, Markdown string or selector buffer per inventory entry.
 */
export const captureTriagePublicationInput = publication => publication?.publication ? Object.freeze({
  recordId: publication.record.recordId, generation: publication.publication.generation,
  markdownPath: publication.mdPath, markdownHash: publication.publication.markdownHash,
  markdownBytes: publication.publication.markdownBytes, jsonPath: publication.jsonPath,
  jsonHash: sha256(publication.selected.buffer), jsonBytes: publication.selected.buffer.length
}) : null;

/** Serialize one ID across processes; different IDs retain independent locks.
 * The callback observes original work and publication through the existing lock
 * owner, which cannot release metadata over an unsettled resource failure.
 */
export const publishTriageRecord = async (recordsDir, input, { signal = null, beforePublish = null, afterRecordStaged = null } = {}) => {
  throwIfAborted(signal);
  const id = input?.recordId;
  const jsonPath = resolveRecordArtifactPathSafe(recordsDir, id, '.json');
  if (!jsonPath || !resolveRecordArtifactPathSafe(recordsDir, id, '.md')) throw invalid('Invalid triage publication target.');
  if (Object.hasOwn(input, TRIAGE_PUBLICATION_FIELD)) throw invalid('An imported record cannot supply publication ownership metadata.');
  if ([beforePublish, afterRecordStaged].some(observer => observer !== null && typeof observer !== 'function')) throw new TypeError('Invalid internal publication observer.');
  // Capture once before any await; later caller mutation cannot change one half
  // of the generation. JSON serialization retains the existing record encoding.
  const serialized = JSON.stringify(input);
  if (!serialized || serialized.length > JSON_MAX_BYTES || Buffer.byteLength(serialized) > JSON_MAX_BYTES) throw invalid('Triage record exceeds publication allowance.');
  const record = JSON.parse(serialized), markdown = renderRecordMarkdown(record);
  if (record.recordId !== id) throw invalid('Record identity changed during input capture.');
  const markdownBytes = Buffer.byteLength(markdown);
  if (!markdownBytes || markdownBytes > MARKDOWN_MAX_BYTES) throw invalid('Triage Markdown exceeds publication allowance.');
  throwIfAborted(signal);
  const root = path.resolve(recordsDir);
  await fs.mkdir(root, { recursive: true }); assertNoSymlinkPath(root, root);
  await ensurePublicationNamespace(root, signal);
  const privateRoot = path.join(root, TRIAGE_GENERATION_DIRECTORY), lockRoot = path.join(privateRoot, 'locks');
  assertNoSymlinkPath(root, lockRoot, { allowMissing: true });
  await fs.mkdir(lockRoot, { recursive: true }); assertNoSymlinkPath(root, lockRoot);
  return withFileLock({ lockPath: path.join(lockRoot, recordKey(id) + '.lock'), signal, waitMs: 5000,
    pollMs: 20, timeoutBehavior: 'throw', timeoutMessage: 'Triage record publication is busy.',
    metadata: { scope: 'triage-record-publication', recordId: id } }, async () => {
    const previous = await readTriagePublication(root, jsonPath, { signal, optional: true });
    if (previous?.record.recordId !== undefined && previous.record.recordId !== id) throw Object.assign(
      new Error('Existing triage record identity differs from the selected target.'), { code: 'ERR_TRIAGE_RECORD_IDENTITY_CONFLICT' });
    if (record.idProvenance?.method === 'fallback-hash' && previous) {
      const content = value => stableStringify({ ...recordContent(value), createdAt: undefined, updatedAt: undefined });
      if (content(previous.record) !== content(record)) throw Object.assign(
        new Error(`Derived triage identity conflict for ${id}; existing artifacts were preserved.`), { code: 'ERR_TRIAGE_RECORD_IDENTITY_CONFLICT' });
    }
    if (previous?.publication && stableStringify(recordContent(previous.record)) === stableStringify(record)) {
      return { jsonPath, mdPath: previous.mdPath, generation: previous.publication.generation,
        generationJsonPath: previous.jsonPath };
    }
    const generation = randomUUID().replaceAll('-', '');
    const locations = pathsFor(root, id, generation), parent = path.dirname(locations.directory);
    assertNoSymlinkPath(root, parent, { allowMissing: true });
    await fs.mkdir(parent, { recursive: true }); assertNoSymlinkPath(root, parent);
    await fs.mkdir(locations.directory); assertNoSymlinkPath(root, locations.directory);
    const receipt = { schemaVersion: 1, generation, recordId: id, recordHash: sha256(stableStringify(record)),
      markdownHash: sha256(markdown), markdownBytes, rendererVersion: TRIAGE_RENDERER_VERSION };
    const payload = JSON.stringify({ [TRIAGE_PUBLICATION_FIELD]: receipt, ...record }, null, 2) + '\n';
    const stageContext = Object.freeze({ ...locations, canonicalJsonPath: jsonPath, generation });
    if (Buffer.byteLength(payload) > JSON_MAX_BYTES) throw invalid('Triage publication envelope exceeds its JSON allowance.');
    try {
      // Retain the exact prior selector as well as every prior immutable payload.
      // This includes the first migration from a legacy JSON/Markdown pair.
      if (previous) await atomicWriteText(path.join(locations.directory, 'previous-record.json'), previous.selected.buffer, { mkdir: false, signal });
      await atomicWriteText(locations.jsonPath, payload, { mkdir: false, signal });
      const recordObserver = await afterRecordStaged?.(stageContext);
      observeStorageResource(recordObserver, { phase: 'triage-publication-record-observer' }).requireSettled();
      await atomicWriteText(locations.mdPath, markdown, { mkdir: false, signal });
      const observerResult = await beforePublish?.(stageContext);
      observeStorageResource(observerResult, { phase: 'triage-publication-observer' }).requireSettled();
      // Inspect original staged bytes after the observer/barrier, before exposing
      // a selector. Failed/incomplete generations stay private and unreferenced.
      await readVerifiedContainedFile(root, locations.jsonPath, { maxBytes: JSON_MAX_BYTES,
        expectedHash: sha256(payload), expectedBytes: Buffer.byteLength(payload), signal });
      await readVerifiedContainedFile(root, locations.mdPath, { maxBytes: MARKDOWN_MAX_BYTES,
        expectedHash: receipt.markdownHash, expectedBytes: markdownBytes, signal });
      assertNoSymlinkPath(root, jsonPath, { allowMissing: true });
      await atomicWriteText(jsonPath, payload, { mkdir: false, signal });
      // No fallible derived write follows the single canonical publication.
      return { jsonPath, mdPath: locations.mdPath, generation, generationJsonPath: locations.jsonPath };
    } catch (error) {
      throw addStorageFailureContext(error, { triagePublication: Object.freeze({ recordId: id, generation,
        canonicalJsonPath: jsonPath, generationDirectory: locations.directory,
        ...(previous ? { previousSelectorPath: path.join(locations.directory, 'previous-record.json') } : {}) }) });
    }
  });
};
