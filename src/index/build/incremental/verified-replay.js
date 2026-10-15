import fs from 'node:fs/promises';
import path from 'node:path';
import { openSemanticCacheEntry } from './semantic-cache.js';
import { canonicalSemanticJson, semanticHash } from '../../semantic/identity.js';
import { readVerifiedContainedFile } from '../../../shared/contained-file.js';
import { validateSemanticPartitions } from '../../semantic/reconcile.js';
import { resolveSemanticPartPath } from '../../../semantic/artifact-store.js';
import { assertIndexCacheLease } from '../cache-lease.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { issueVerifiedReplayToken, consumeVerifiedReplayToken, recordVerifiedReplayConsumption, invalidateVerifiedReplayToken,
  replayIdentity, replayStatIdentity } from './replay-authority.js';

/** Keep only bounded immutable verification metadata, never source bytes or decoded rows. */
export const createSemanticReplayVerificationContext = ({ bundleDir, maxBytes, lease }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('A positive replay metadata byte bound is required.');
  assertIndexCacheLease(lease);
  bundleDir = path.resolve(bundleDir);
  const cache = new Map(), receipts = [], witnesses = new WeakSet();
  const tokenBudget = Math.floor(maxBytes * 3 / 4), receiptBudget = maxBytes - tokenBudget;
  let active = true, metadataBytes = 0, receiptBytes = 0;
  const metrics = { verificationHits: 0, verificationMisses: 0, verificationBytes: 0,
    verificationWallMs: 0, uncachedVerifications: 0, currentSourceBytesRead: 0, copiedBytes: 0, copyWallMs: 0,
    consumedReplays: 0, metadataBytes: 0, peakMetadataBytes: 0, droppedReceipts: 0 };
  const updateBytes = () => {
    metrics.metadataBytes = metadataBytes + receiptBytes;
    metrics.peakMetadataBytes = Math.max(metrics.peakMetadataBytes, metrics.metadataBytes);
  };
  const remove = key => {
    const prior = cache.get(key);
    if (prior) { metadataBytes -= prior.bytes; invalidateVerifiedReplayToken(prior.token); }
    cache.delete(key); updateBytes();
  };
  const record = (receipt, factsRef) => {
    if (!active || !witnesses.has(receipt) || receipt.sourceUnitId !== factsRef.sourceUnitId
      || receipt.sourceHash !== factsRef.sourceHash || receipt.locator.canonicalHash !== factsRef.canonicalHash) return;
    metrics.consumedReplays += 1;
    const size = Buffer.byteLength(canonicalSemanticJson(receipt));
    if (receiptBytes + size > receiptBudget) { metrics.droppedReceipts += 1; return; }
    receipts.push(receipt); receiptBytes += size; updateBytes();
  };
  const inventoryFor = async (opened, locator, signal) => {
    const inventory = [], seen = new Set();
    let bytes = 0, metadata = 0, admitted = true;
    const add = async (root, relative) => {
      throwIfAborted(signal);
      const filename = await resolveSemanticPartPath(root, relative);
      if (seen.has(filename)) return;
      seen.add(filename);
      const stat = await fs.stat(filename, { bigint: true });
      if (!stat.isFile() || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw Object.assign(new Error('Invalid replay inventory member.'), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
      bytes += Number(stat.size);
      if (!Number.isSafeInteger(bytes)) throw new Error('Replay inventory exceeds safe byte accounting.');
      const item = { root, relative, filename, signature: replayStatIdentity(stat) };
      metadata += Buffer.byteLength(canonicalSemanticJson(item));
      if (metadata > tokenBudget) { admitted = false; inventory.length = 0; }
      if (admitted) inventory.push(item);
    };
    await add(bundleDir, 'semantic/' + locator.cacheKey + '/descriptor.json');
    for (const partition of opened.factsRef.partitions) {
      for (const pieces of Object.values(partition.members)) for (const piece of pieces) {
        await add(opened.root, piece.path); await add(opened.root, piece.offsetsPath);
      }
      for await (const source of opened.store.iterateRows(partition.partitionId, 'semantic_sources', { signal })) {
        await add(opened.root, 'semantic-sources/' + source.byteHash + '.utf8');
        if (source.mapping) await add(opened.root, source.mapping.mapRef);
      }
    }
    return { inventory: admitted ? inventory : null, bytes, metadata };
  };
  const verify = async options => {
    if (!active) throw new Error('Replay verification context has been cleared.');
    assertIndexCacheLease(lease); throwIfAborted(options.signal);
    const input = { ...options, bundleDir, locator: structuredClone(options.locator),
      dependencySignatures: structuredClone(options.dependencySignatures) };
    const identity = replayIdentity(input), prior = cache.get(identity);
    if (prior) {
      const opened = await consumeVerifiedReplayToken({ ...input, token: prior.token });
      if (opened) { cache.delete(identity); cache.set(identity, prior); metrics.verificationHits += 1; return { ...opened, token: prior.token, verificationReceipt: prior.receipt }; }
      remove(identity);
    }
    metrics.verificationMisses += 1;
    const started = performance.now();
    const opened = await openSemanticCacheEntry({ repoRoot: input.repoRoot, bundleDir, locator: input.locator,
      expectedDependencySignatures: input.dependencySignatures, expectedSourceHash: input.sourceHash,
      expectedSourcePath: input.sourcePath, expectedRepositoryNamespace: input.repositoryNamespace, signal: input.signal });
    const before = await inventoryFor(opened, input.locator, input.signal);
    await validateSemanticPartitions({ store: opened.store, partitions: opened.factsRef.partitions, signal: input.signal });
    const mappings = new Set();
    for (const partition of opened.factsRef.partitions) {
      for await (const source of opened.store.iterateRows(partition.partitionId, 'semantic_sources', { signal: input.signal })) {
        if (!source.mapping || mappings.has(source.mapping.mapRef)) continue;
        mappings.add(source.mapping.mapRef);
        const relative = source.mapping.mapRef;
        if (!/^semantic-evidence\/[a-f0-9]{64}\.json$/.test(relative)) throw Object.assign(new Error('Invalid replay mapping evidence path.'), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
        let buffer;
        try { ({ buffer } = await readVerifiedContainedFile(opened.root, path.join(opened.root, relative),
          { maxBytes: 16 * 1024 * 1024, expectedHash: path.basename(relative, '.json'), signal: input.signal })); }
        catch (error) {
          throwIfAborted(input.signal);
          if (['ERR_FILE_TOO_LARGE', 'ERR_FILE_CHANGED', 'ERR_FILE_INTEGRITY', 'ERR_UNSAFE_FILE_PATH'].includes(error.code)) {
            throw Object.assign(new Error('Replay mapping verification failed.'), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
          }
          throw error;
        }
        if (semanticHash('semantic.embedded-map.v1', JSON.parse(buffer.toString('utf8'))) !== source.mapping.identity) {
          throw Object.assign(new Error('Replay mapping identity mismatch.'), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
        }
      }
    }
    const after = await inventoryFor(opened, input.locator, input.signal);
    if (before.inventory && after.inventory
      && canonicalSemanticJson(before.inventory) !== canonicalSemanticJson(after.inventory)) {
      throw Object.assign(new Error('Semantic cache changed during replay verification.'), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
    }
    metrics.verificationBytes += after.bytes;
    metrics.verificationWallMs += performance.now() - started;
    assertIndexCacheLease(lease);
    if (!active) throw new Error('Replay verification context has been cleared.');
    const receipt = Object.freeze({ sourceUnitId: opened.factsRef.sourceUnitId, sourceHash: opened.factsRef.sourceHash,
      locator: Object.freeze(structuredClone(input.locator)), verifiedBytes: after.bytes });
    witnesses.add(receipt);
    const bytes = Buffer.byteLength(identity) + Buffer.byteLength(canonicalSemanticJson(opened.factsRef)) * 3
      + after.metadata + Buffer.byteLength(canonicalSemanticJson(receipt));
    if (!after.inventory || bytes > tokenBudget) { metrics.uncachedVerifications += 1; return { ...opened, token: null, verificationReceipt: receipt }; }
    remove(identity);
    while (metadataBytes + bytes > tokenBudget) remove(cache.keys().next().value);
    let token;
    token = issueVerifiedReplayToken({ identity, opened, inventory: after.inventory, lease,
      isActive: () => active && cache.get(identity)?.token === token,
      onConsumed: factsRef => record(receipt, factsRef) });
    cache.set(identity, { token, bytes, receipt }); metadataBytes += bytes; updateBytes();
    return { ...opened, token, verificationReceipt: receipt };
  };
  return Object.freeze({ verify, metrics,
    recordSourceRead(bytes) { metrics.currentSourceBytesRead += bytes; },
    recordReplay(token, factsRef, receipt = null) {
      if (!recordVerifiedReplayConsumption(token, factsRef)) record(receipt, factsRef);
    },
    snapshotReceipts() { return receipts.map(receipt => structuredClone(receipt)); },
    clear() { active = false; for (const key of cache.keys()) remove(key); }
  });
};
