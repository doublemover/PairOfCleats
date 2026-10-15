import fs from 'node:fs/promises';
import { canonicalSemanticJson } from '../../semantic/identity.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { assertIndexCacheLease } from '../cache-lease.js';
import { throwIfAborted } from '../../../shared/abort.js';

const tokens = new WeakMap();
export const invalidateVerifiedReplayToken = token => { tokens.delete(token); };
export const replayIdentity = ({ bundleDir, locator, dependencySignatures, sourceHash,
  sourcePath, repositoryNamespace }) => canonicalSemanticJson({ bundleDir, locator,
  dependencySignatures, sourceHash, sourcePath, repositoryNamespace });
export const replayStatIdentity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');

/** Tokens contain no caller-editable authority and are usable only under their writer lease. */
export const issueVerifiedReplayToken = ({ identity, opened, inventory, lease, isActive, onConsumed }) => {
  assertIndexCacheLease(lease);
  const token = Object.freeze({});
  const snapshot = { ...opened, factsRef: structuredClone(opened.factsRef),
    dependencySignatures: structuredClone(opened.dependencySignatures) };
  Object.freeze(snapshot.store);
  tokens.set(token, { identity, opened: snapshot, inventory, lease, isActive, onConsumed });
  return token;
};

export const consumeVerifiedReplayToken = async ({ token, signal, ...options }) => {
  const authority = tokens.get(token);
  if (!authority || !authority.isActive() || authority.identity !== replayIdentity(options)) return null;
  assertIndexCacheLease(authority.lease);
  for (const item of authority.inventory) {
    throwIfAborted(signal);
    const filename = await resolveSemanticPartPath(item.root, item.relative);
    if (filename !== item.filename || replayStatIdentity(await fs.stat(filename, { bigint: true })) !== item.signature) return null;
  }
  assertIndexCacheLease(authority.lease);
  return { ...authority.opened, factsRef: structuredClone(authority.opened.factsRef),
    dependencySignatures: structuredClone(authority.opened.dependencySignatures) };
};

export const recordVerifiedReplayConsumption = (token, factsRef) => {
  const authority = tokens.get(token);
  if (!authority?.isActive()) return false;
  authority.onConsumed(factsRef);
  return true;
};
