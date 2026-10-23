import path from 'node:path';
import { compileSchema, createAjv } from '../shared/validation/ajv-factory.js';
import { CONTEXT_TASK_POLICY_SCHEMA } from '../contracts/schemas/context-task.js';
import { CONTEXT_PACK_RESPONSE_MAX_BYTES } from './response-budget.js';
import { resolveExcerpt } from './excerpt-cache.js';
import { throwIfAborted } from '../shared/abort.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';

const validatePolicy = compileSchema(createAjv({ strict: true, allErrors: true }), CONTEXT_TASK_POLICY_SCHEMA);
const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
export const resolveContextTaskPolicy = input => {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('ERR_CONTEXT_PACK_INVALID_REQUEST', 'Invalid context task policy.');
  const captured = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw failure('ERR_CONTEXT_PACK_INVALID_REQUEST', 'Task policy requires own JSON data fields.');
    captured[key] = descriptor.value;
  }
  if (!validatePolicy(captured)) throw failure('ERR_CONTEXT_PACK_INVALID_REQUEST', 'Invalid context task policy.');
  return Object.freeze({ ...captured, wholeFileFallback: captured.wholeFileFallback === true });
};

/** Complete files are the only currently admitted edit boundary. A chunk span
 * does not prove that the parser retained a whole function after chunk splitting.
 */
export const buildTaskPrimaryExcerpt = ({ taskPolicy, chunk, seed, repoRoot, indexSignature, maxBytes, maxTokens, signal, warnings }) => {
  throwIfAborted(signal);
  if (!chunk?.file || seed?.status && seed.status !== 'resolved') throw failure('ERR_CONTEXT_PACK_UNIT_UNAVAILABLE', 'Edit-safe primary requires one unambiguous indexed source file.');
  if (taskPolicy.granularity === 'function' && !taskPolicy.wholeFileFallback) {
    throw failure('ERR_CONTEXT_PACK_UNIT_UNAVAILABLE', 'Complete function boundaries are unavailable; allow an explicit whole-file fallback or request file granularity.');
  }
  const indexedHash = chunk.fileHash || chunk.metaV2?.fileHash;
  const hashAlgorithm = (chunk.fileHashAlgo || chunk.metaV2?.fileHashAlgo) === 'sha256' ? 'sha256' : 'sha1';
  if (!indexSignature || typeof indexedHash !== 'string' || !new RegExp(`^(?:${hashAlgorithm}:)?[a-f0-9]{${hashAlgorithm === 'sha256' ? 64 : 40}}$`, 'i').test(indexedHash)) {
    throw failure('ERR_CONTEXT_PACK_UNIT_UNAVAILABLE', 'Edit-safe primary requires a pinned index signature and retained full source hash.');
  }
  let excerpt;
  try {
    excerpt = resolveExcerpt({ filePath: path.resolve(repoRoot, chunk.file), repoRoot, start: null, end: null,
      maxBytes: Math.min(CONTEXT_PACK_RESPONSE_MAX_BYTES, maxBytes ?? CONTEXT_PACK_RESPONSE_MAX_BYTES),
      maxTokens, indexSignature, indexedHash, hashAlgorithm, taskPolicy, signal });
  } catch (error) {
    observeStorageResource(error, { phase: 'context-edit-unit' }).requireSettled();
    throwIfAborted(signal);
    if (error.code === 'ERR_FILE_TOO_LARGE') throw failure('ERR_CONTEXT_PACK_UNIT_CANNOT_FIT', 'The mandatory complete edit unit cannot fit the source byte allowance.', 413);
    if (['ERR_CONTEXT_PACK_UNIT_CANNOT_FIT', 'ERR_CONTEXT_PACK_SOURCE_MISMATCH'].includes(error.code)) throw error;
    throw failure('ERR_CONTEXT_PACK_UNIT_UNAVAILABLE', 'The indexed edit source is missing, outside the repository, invalid UTF-8 or unavailable.');
  }
  throwIfAborted(signal);
  const fallbackUsed = taskPolicy.granularity === 'function';
  if (fallbackUsed) warnings.push({ code: 'CONTEXT_EDIT_WHOLE_FILE_FALLBACK', message: 'Complete function boundaries are unavailable; the requested policy explicitly permits a complete verified file.' });
  return { ...excerpt, file: chunk.file, range: null, truncated: false,
    unit: { schemaVersion: 1, granularity: 'file', requestedGranularity: taskPolicy.granularity, fallbackUsed,
      boundaries: 'complete-file', coordinateUnit: 'utf16', span: [0, excerpt.sourceLength],
      byteLength: Buffer.byteLength(excerpt.excerpt), sourceHash: excerpt.sourceIdentity.currentHash, indexSignature },
    evidence: { state: 'file-backed', source: 'indexed-source-verified', fileBacked: true, sourceIdentity: excerpt.sourceIdentity,
      substituted: false, missing: false, truncated: false, truncatedBytes: false, truncatedTokens: false,
      warningCodes: fallbackUsed ? ['CONTEXT_EDIT_WHOLE_FILE_FALLBACK'] : [] } };
};
