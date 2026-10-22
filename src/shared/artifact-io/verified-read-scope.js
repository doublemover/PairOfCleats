import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { throwIfAborted } from '../abort.js';

const scope = new AsyncLocalStorage();
const statKeys = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'];
export const artifactReadStamp = stat => statKeys.map(key => String(stat[key]));
export const sameArtifactReadStamp = (left, right) => left.every((value, index) => value === right[index]);
export const currentVerifiedArtifactReadScope = () => scope.getStore() || null;
export const withVerifiedArtifactReadScope = (context, operation) => scope.run(context, operation);

// Only bytes whose descriptor containment/identity has already been verified may be recorded.
export const recordVerifiedArtifactRead = (root, target, result, algorithm = 'sha256') => {
  const active = scope.getStore();
  if (active?.root !== path.resolve(root) || active.enabled === false) return;
  throwIfAborted(active.signal);
  const resolved = path.resolve(target);
  const hash = algorithm === 'sha256' ? result.hash : crypto.createHash('sha256').update(result.buffer).digest('hex');
  const certificate = { hash, digests: { sha256: hash, [algorithm]: result.hash }, bytes: result.stat.size, stamp: artifactReadStamp(result.stat) };
  if (active.recordBuffer) active.recordBuffer(resolved, result.buffer, certificate);
  else active.record(resolved, certificate);
};

/** Sequential physical-byte witness; no raw bytes survive update(). */
export const beginVerifiedArtifactRead = (root, target, fd) => {
  const active = scope.getStore();
  if (!active || !root || active.root !== path.resolve(root) || active.enabled === false) return null;
  const before = fs.fstatSync(fd);
  throwIfAborted(active.signal);
  const hash = crypto.createHash('sha256');
  const additional = active.hashersFor?.(path.resolve(target)) || {};
  const additionalHashers = Object.values(additional);
  let position = 0;
  let valid = true;
  let finished = false;
  return {
    signal: active.signal || null,
    update(bytes, offset = position) {
      throwIfAborted(active.signal);
      if (finished || offset !== position) { valid = false; return; }
      hash.update(bytes);
      for (const hasher of additionalHashers) hasher.update(bytes);
      position += bytes.length;
    },
    finish(verify) {
      if (finished) return;
      finished = true;
      throwIfAborted(active.signal);
      verify();
      const after = fs.fstatSync(fd);
      if (!sameArtifactReadStamp(artifactReadStamp(before), artifactReadStamp(after))) {
        throw Object.assign(new Error('Artifact changed during verification.'), { code: 'ERR_FILE_CHANGED' });
      }
      if (!valid || position !== before.size) return;
      const digest = hash.digest('hex');
      const digests = { sha256: digest };
      for (const [algorithm, hasher] of Object.entries(additional)) digests[algorithm] = hasher.digest('hex');
      const certificate = { hash: digest, digests, bytes: before.size, stamp: artifactReadStamp(after) };
      active.record(path.resolve(target), certificate);
      return certificate;
    }
  };
};

/** Small decoded metadata is borrowed only within this fresh-content invocation. */
export const readVerifiedArtifactJson = (target, options, load) => {
  const active = scope.getStore();
  if (!active || !options?.containedRoot || path.resolve(options.containedRoot) !== active.root
    || !/(?:\.meta\.json|[\\/]manifest\.json|[\\/]index_state\.json|[\\/]semantic_operation_index\.json)$/i.test(target)) return load();
  return active.readJson ? active.readJson(path.resolve(target), options, load) : load();
};
