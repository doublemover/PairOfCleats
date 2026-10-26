import path from 'node:path';
import { createHash } from 'node:crypto';
import { RECORD_SOURCE_VERSION, RECORD_SOURCE_PREFIX } from '../../contracts/record-source.js';
import { canonicalBundleSourceKey } from '../../shared/bundle-source-key.js';
import { toPosix } from '../../shared/file-paths.js';
import { stableStringify } from '../../shared/stable-json.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { sha1 } from '../../shared/hash.js';

const rootPath = value => {
  if (typeof value !== 'string' || !value.trim()) throw fail('A selected record source root is required.');
  const resolved = toPosix(path.resolve(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const hash = (domain, value) => createHash('sha256').update(`${domain}\0${JSON.stringify(value)}`).digest('hex');
const fail = (message, code = 'ERR_RECORD_SOURCE_REBUILD') => Object.assign(new Error(message), { code });

export const createRecordSourceReference = ({ repoRoot, recordsDir, kind, relativePath, contentHash = null }) => {
  if (!['repository', 'triage'].includes(kind)) throw fail('Unknown record source kind.');
  const relative = canonicalBundleSourceKey(relativePath);
  if (relative !== relativePath) throw fail('Record source paths must be canonical.');
  const repository = rootPath(repoRoot), selectedRoot = kind === 'triage' ? rootPath(recordsDir) : repository;
  const repositoryKey = `rr1-${hash('record-repository-v1', repository)}`;
  const rootKey = `rs1-${hash('record-source-root-v1', [repository, kind, selectedRoot])}`;
  return { schemaVersion: RECORD_SOURCE_VERSION, kind, repositoryKey, rootKey, relativePath: relative,
    storagePath: `${RECORD_SOURCE_PREFIX}${kind}/${rootKey}/${relative}`,
    displayPath: kind === 'triage' ? `triage/records/${relative}` : relative, contentHash, hashAlgo: 'sha1' };
};

/** Actual selected inventory owns source kind. A configured triage root inside
 * the repo has one triage source, independent of discovery order/metadata. */
export const createRecordSourceUnion = ({ repoRoot, recordsDir }) => {
  const physical = new Map();
  const add = (absPath, kind, recordMeta) => {
    const root = kind === 'triage' ? recordsDir : repoRoot;
    const relativePath = toPosix(path.relative(root, path.resolve(absPath)));
    const recordSource = createRecordSourceReference({ repoRoot, recordsDir, kind, relativePath });
    const key = rootPath(absPath), previous = physical.get(key);
    if (previous) {
      if (previous.recordSource.kind !== kind) {
        if (kind === 'repository') return;
      } else {
        if (stableStringify(previous.recordMeta) !== stableStringify(recordMeta)) {
          throw fail(`Conflicting duplicate record source: ${kind}:${recordSource.rootKey}:${relativePath}`, 'ERR_RECORD_SOURCE_COLLISION');
        }
        return;
      }
    }
    physical.set(key, { absPath: path.resolve(absPath), root, relPath: relativePath, recordMeta, recordSource });
  };
  return {
    addRepository(entry) { add(entry.abs, 'repository', entry.record); },
    addTriage(absPath) { add(absPath, 'triage', { source: 'triage', recordType: 'record', reason: 'records-dir' }); },
    finish() {
      const identities = new Map();
      for (const source of physical.values()) {
        const key = source.recordSource.storagePath;
        if (identities.has(key)) throw fail(`Duplicate canonical record source: ${key}`, 'ERR_RECORD_SOURCE_COLLISION');
        identities.set(key, source);
      }
      return [...identities.values()].sort((a, b) => a.recordSource.storagePath < b.recordSource.storagePath ? -1 : 1);
    }
  };
};

/** Select exactly one configured root and verify the original bytes before any
 * deferred cache/provider work. No triage-prefix fallback grants root authority.
 * Legacy unprefixed repo products remain readable with an original byte hash. */
export const readRecordEmbeddingSource = async ({ repoRoot, recordsDir, file, items, signal = null }) => {
  if (!Array.isArray(items) || !items.length) throw fail('Record source requires retained chunks.');
  const chunks = items.map(item => item.chunk || item);
  const references = chunks.map(chunk => chunk.recordSource || chunk.metaV2?.recordSource || null);
  const reference = references[0];
  let root, relativePath, contentHash;
  if (reference) {
    if (reference.schemaVersion !== RECORD_SOURCE_VERSION || reference.hashAlgo !== 'sha1'
      || typeof reference.contentHash !== 'string' || !/^[a-f0-9]{40}$/.test(reference.contentHash)) throw fail('Unsupported record source reference.');
    const expected = createRecordSourceReference({ repoRoot, recordsDir, kind: reference.kind,
      relativePath: reference.relativePath, contentHash: reference.contentHash });
    if (expected.storagePath !== file || stableStringify(expected) !== stableStringify(reference)
      || references.some(value => stableStringify(value) !== stableStringify(reference))) throw fail('Record source namespace differs from the selected repository/root.');
    root = reference.kind === 'triage' ? recordsDir : repoRoot;
    relativePath = reference.relativePath; contentHash = reference.contentHash;
    if (chunks.some(chunk => (chunk.fileHash || chunk.metaV2?.fileHash)
      && (chunk.fileHash || chunk.metaV2?.fileHash) !== contentHash)) throw fail('Record chunk byte identity differs from its source reference.');
  } else {
    if (file.startsWith(RECORD_SOURCE_PREFIX) || file.startsWith('triage/records/') || references.some(Boolean)) {
      throw fail('Ambiguous legacy record source requires rebuilding the records index.');
    }
    root = repoRoot; relativePath = canonicalBundleSourceKey(file);
    contentHash = chunks[0].fileHash || chunks[0].metaV2?.fileHash;
    if (typeof contentHash !== 'string' || !/^[a-f0-9]{40}$/.test(contentHash)
      || chunks.some(chunk => (chunk.fileHash || chunk.metaV2?.fileHash) !== contentHash)) throw fail('Legacy record source lacks original byte identity; rebuild required.');
  }
  const absPath = path.resolve(root, relativePath);
  const source = await readVerifiedContainedFile(root, absPath, { maxBytes: 32 * 1024 * 1024, signal });
  const actualHash = sha1(source.buffer);
  if (actualHash !== contentHash) throw fail('Record source changed after indexing; rebuild required.');
  return { absPath, text: source.buffer.toString('utf8'), hash: actualHash, sourceHash: actualHash, encoding: 'utf8' };
};
