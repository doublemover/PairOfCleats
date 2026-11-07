import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertDirectoryIdentity } from '../../src/shared/io/directory-sync.js';
import { persistenceFileIdentity, assertPersistenceFileIdentity } from '../../src/shared/io/file-identity.js';
import { readFileResourceBytesSync } from '../../src/shared/file-read-resource.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { requireCheckoutMutationSession } from './checkout-mutation.js';

export const CHECKOUT_EVIDENCE_LIMITS = Object.freeze({ bytes: 256 * 1024 * 1024, reserveBytes: 44 * 1024 * 1024,
  entries: 16384, scanMs: 10000, files: 1536, manifests: 256, metadataBytes: 16 * 1024 * 1024,
  manifestBytes: 1024 * 1024, fileBytes: 8 * 1024 * 1024 });
export const evidenceFailure = message => Object.assign(new Error(message), { code: 'ERR_CHECKOUT_EVIDENCE_RETENTION' });
const directoryRecord = (relative, stat) => {
  if (stat.isSymbolicLink() || stat.ino === 0n) throw evidenceFailure('Evidence requires ordinary identified parents.');
  assertDirectoryIdentity(stat);
  return Object.freeze({ path: relative, dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs ?? stat.birthtimeMs) });
};
const assertEvidencePath = relative => {
  if (typeof relative !== 'string' || !/^\.tmp\/checkout-bootstrap\/(?:j-[a-zA-Z0-9_-]{6,32}|logs\/n-[a-zA-Z0-9_-]{6,32})\/[a-zA-Z0-9.-]+$/.test(relative)) throw evidenceFailure('Evidence path is outside its registered category.');
};
export const captureEvidenceParents = (root, relative) => {
  assertEvidencePath(relative);
  const parents = []; let current = '';
  for (const part of relative.split('/').slice(0, -1)) {
    current += (current ? '/' : '') + part;
    parents.push(directoryRecord(current, fs.lstatSync(path.join(root, current), { bigint: true })));
  }
  return Object.freeze(parents);
};
export const checkEvidenceParents = (root, parents) => {
  for (const original of parents) {
    const actual = directoryRecord(original.path, fs.lstatSync(path.join(root, original.path), { bigint: true }));
    if (['dev', 'ino', 'birthtime'].some(key => actual[key] !== original[key])) throw evidenceFailure('Evidence parent changed after admission.');
  }
};
/** Original contained read/close owner, with finite bytes and exact comparison
 * metadata. A record itself never grants deletion or native lifetime authority. */
export const readEvidenceFile = (root, expected, parents = captureEvidenceParents(root, expected.path), maxBytes = CHECKOUT_EVIDENCE_LIMITS.fileBytes) => {
  assertEvidencePath(expected.path);
  checkEvidenceParents(root, parents);
  const target = path.join(root, expected.path), identity = expected.identity || persistenceFileIdentity(fs.lstatSync(target, { bigint: true }));
  assertPersistenceFileIdentity(fs.lstatSync(target, { bigint: true }), identity);
  const bytes = readFileResourceBytesSync(target, stat => {
    if (stat.size > maxBytes || (expected.bytes !== undefined && stat.size !== expected.bytes)) throw evidenceFailure('Evidence file exceeds or differs from its admitted byte extent.');
  }, stat => assertPersistenceFileIdentity(stat, identity));
  checkEvidenceParents(root, parents); assertPersistenceFileIdentity(fs.lstatSync(target, { bigint: true }), identity);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expected.sha256 !== undefined && expected.sha256 !== sha256) throw evidenceFailure('Evidence bytes differ from their original recorded hash.');
  return Object.freeze({ path: expected.path, bytes: bytes.length, sha256, identity });
};
export const readEvidenceJson = (root, relative, maxBytes = CHECKOUT_EVIDENCE_LIMITS.manifestBytes) => {
  const parents = captureEvidenceParents(root, relative), record = readEvidenceFile(root, { path: relative }, parents, maxBytes);
  // Read under the same exact identity again; JSON conversion cannot relax the
  // raw-byte proof or accept edited/replaced metadata between observations.
  const bytes = readFileResourceBytesSync(path.join(root, relative), stat => {
    if (stat.size !== record.bytes) throw evidenceFailure('Evidence metadata extent changed.');
  }, stat => assertPersistenceFileIdentity(stat, record.identity));
  checkEvidenceParents(root, parents); assertPersistenceFileIdentity(fs.lstatSync(path.join(root, relative), { bigint: true }), record.identity);
  return { value: JSON.parse(bytes.toString('utf8')), record, parents };
};
export const publishEvidenceJson = async (root, session, relative, value, maxBytes = CHECKOUT_EVIDENCE_LIMITS.manifestBytes) => {
  requireCheckoutMutationSession(root, session);
  const parents = captureEvidenceParents(root, relative), target = path.join(root, relative), serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > maxBytes) throw evidenceFailure('Evidence metadata exceeds its publication bound.');
  const actual = await atomicWriteJson(target, value, { mkdir: false, createOnly: true, mode: 0o600,
    durable: true, spaces: 0, newline: false, beforeCommit: () => {
      requireCheckoutMutationSession(root, session); checkEvidenceParents(root, parents);
    } });
  if (actual !== target) throw evidenceFailure('Evidence publication did not confirm its original target.');
  const record = readEvidenceFile(root, { path: relative, bytes: Buffer.byteLength(serialized),
    sha256: createHash('sha256').update(serialized).digest('hex') }, parents, maxBytes);
  requireCheckoutMutationSession(root, session); return record;
};
