import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertNoSymlinkPath, withContainedFile } from '../../shared/contained-file.js';
import { readExactAt } from '../../shared/io/read-exact.js';
import { throwIfAborted } from '../../shared/abort.js';
import { artifactReadStamp, sameArtifactReadStamp, beginVerifiedArtifactRead } from '../../shared/artifact-io/verified-read-scope.js';
import { createXxhash64HasherFactory } from '../../shared/hash/xxhash-backend.js';
import { isManifestPathSafe, normalizeManifestPath } from './paths.js';
import { fromPosix } from '../../shared/file-paths.js';

const MAX_CERTIFICATES = 65536;
const METADATA_MEMBER_BYTES = 1024 * 1024;
const METADATA_TOTAL_BYTES = 8 * 1024 * 1024;
const changed = () => Object.assign(new Error('Selected artifact changed during validation.'), { code: 'ERR_FILE_CHANGED' });

/** Invocation-local integrity evidence; no complete artifact byte buffers are retained. */
export const createValidationReadPlan = ({ root, signal = null, metrics = {} }) => {
  const resolvedRoot = path.resolve(root);
  const certificates = new Map();
  const expectedAlgorithms = new Map();
  const metadata = new Map();
  let metadataBytes = 0;
  let xxhashFactory = null;
  let sealed = false;
  let metricPaths = 0;
  const validateCertificate = (target, certificate) => {
    throwIfAborted(signal);
    assertNoSymlinkPath(resolvedRoot, target);
    if (!sameArtifactReadStamp(certificate.stamp, artifactReadStamp(fs.statSync(target)))) throw changed();
  };
  const plan = {
    root: resolvedRoot,
    enabled: true,
    signal,
    async prepare(manifest) {
      // Large manifests retain the original eager checksum gate. Do not replace missing decode
      // evidence with a later unrelated read after exceeding the invocation witness envelope.
      if (manifest.pieces.length > MAX_CERTIFICATES / 4) {
        plan.enabled = false; metrics.fallbackReason = 'manifest-witness-envelope'; return false;
      }
      for (const piece of manifest.pieces) {
        if (!isManifestPathSafe(piece?.path)) continue;
        const checksum = /^(sha1|sha256|xxh64):([0-9a-f]+)$/i.exec(String(piece.checksum || ''));
        if (!checksum) continue;
        const algorithm = checksum[1].toLowerCase();
        if (checksum[2].length !== { sha1: 40, sha256: 64, xxh64: 16 }[algorithm]) continue;
        if (algorithm === 'xxh64' && !xxhashFactory) xxhashFactory = await createXxhash64HasherFactory();
        const target = path.resolve(resolvedRoot, fromPosix(normalizeManifestPath(piece.path)));
        if (!expectedAlgorithms.has(target)) {
          expectedAlgorithms.set(target, new Set());
        }
        expectedAlgorithms.get(target).add(algorithm);
      }
      return true;
    },
    hashersFor(target) {
      const hashers = {};
      for (const algorithm of expectedAlgorithms.get(target) || []) {
        if (algorithm === 'sha1') hashers.sha1 = crypto.createHash('sha1');
        else if (algorithm === 'xxh64') hashers.xxh64 = xxhashFactory();
      }
      return hashers;
    },
    recordBuffer(target, bytes, certificate) {
      for (const [algorithm, hasher] of Object.entries(plan.hashersFor(target))) {
        if (certificate.digests[algorithm]) continue;
        hasher.update(bytes); certificate.digests[algorithm] = hasher.digest('hex');
      }
      plan.record(target, certificate);
    },
    record(target, certificate) {
      throwIfAborted(signal);
      if (!plan.enabled) return;
      if (sealed) throw new Error('Validation read plan is already sealed.');
      const previous = certificates.get(target);
      if (previous && (previous.hash !== certificate.hash || !sameArtifactReadStamp(previous.stamp, certificate.stamp))) throw changed();
      if (!previous && certificates.size >= MAX_CERTIFICATES) {
        throw Object.assign(new Error('Validation descriptor witness envelope exceeded.'), { code: 'ERR_VALIDATION_READ_WITNESS_LIMIT' });
      }
      certificates.set(target, certificate);
      metrics.verifiedReads = (metrics.verifiedReads || 0) + 1;
      metrics.verifiedBytes = (metrics.verifiedBytes || 0) + certificate.bytes;
      const byPath = metrics.readsByPath ||= {};
      // Per-path diagnostic counters share the bounded certificate envelope.
      if (Object.hasOwn(byPath, target)) byPath[target] += 1;
      else if (metricPaths < MAX_CERTIFICATES) { byPath[target] = 1; metricPaths += 1; }
    },
    readJson(target, options, load) {
      if (!plan.enabled) return load();
      const key = JSON.stringify([target, options.maxBytes, options.recoveryFallback === true]);
      const prior = metadata.get(key);
      if (prior) { validateCertificate(target, prior.certificate); return prior.value; }
      const value = load();
      const certificate = certificates.get(target);
      if (certificate && certificate.bytes <= METADATA_MEMBER_BYTES && metadataBytes + certificate.bytes <= METADATA_TOTAL_BYTES) {
        metadata.set(key, { value, certificate }); metadataBytes += certificate.bytes;
      }
      return value;
    },
    async checksum(target, algorithm) {
      throwIfAborted(signal);
      const resolved = path.resolve(target);
      const certificate = certificates.get(resolved);
      if (certificate?.digests?.[algorithm]) {
        validateCertificate(resolved, certificate);
        metrics.reusedIntegrityReads = (metrics.reusedIntegrityReads || 0) + 1;
        return certificate.digests[algorithm];
      }
      // A declared algorithm may need a certificate when a format consumed only an auxiliary span.
      const beforeAlgorithms = expectedAlgorithms.get(resolved);
      if (!beforeAlgorithms?.has(algorithm)) expectedAlgorithms.set(resolved, new Set([...(beforeAlgorithms || []), algorithm]));
      try {
        const publish = await withContainedFile(resolvedRoot, resolved, async descriptor => {
          const witness = beginVerifiedArtifactRead(resolvedRoot, resolved, descriptor.fd);
          const size = witness?.byteLength;
          if (!Number.isSafeInteger(size) || size < 0) throw changed();
          const buffer = Buffer.alloc(Math.min(65536, Math.max(1, size)));
          for (let position = 0; position < size;) {
            const length = Math.min(buffer.length, size - position);
            const { bytesRead } = await readExactAt(descriptor, buffer, 0, length, position, { signal });
            if (bytesRead !== length) throw changed();
            const bytes = buffer.subarray(0, bytesRead);
            witness.update(bytes, position); position += bytesRead;
          }
          return witness.prepare(() => descriptor.verify());
        });
        // The live descriptor proves bytes/identity; only its confirmed close
        // permits publication. Failed-close recovery cannot invoke this callback.
        const digest = publish?.()?.digests?.[algorithm];
        if (typeof digest !== 'string') throw changed();
        metrics.checksumOnlyReads = (metrics.checksumOnlyReads || 0) + 1;
        return digest;
      }
      finally {
        if (!beforeAlgorithms) expectedAlgorithms.delete(resolved);
        else expectedAlgorithms.set(resolved, beforeAlgorithms);
      }
    },
    finish() {
      throwIfAborted(signal);
      for (const [target, certificate] of certificates) validateCertificate(target, certificate);
      sealed = true; metadata.clear(); metadataBytes = 0;
    }
  };
  return plan;
};
