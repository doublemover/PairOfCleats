import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../semantic/identity.js';
import { providerProfileCacheIdentity, verifyProviderProfileReceipt } from './provider-profile.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { throwIfAborted } from '../../shared/abort.js';

const owners = new WeakMap();
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const fail = message => Object.assign(new Error(message), { code: 'ERR_TOOLING_INVOCATION_IDENTITY' });
const fileKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

/** Exact selected source/target context. This is internal admission, not a new
 * source identity format. Unknown/non-JSON inputs cannot qualify durable use. */
const inputIdentity = (ctx, inputs) => {
  const documents = inputs?.documents, targets = inputs?.targets || [];
  if (!Array.isArray(documents) || !documents.length || documents.length > 16384
    || !Array.isArray(targets) || targets.length > 100000) throw fail('Invalid bounded invocation input inventory.');
  let bytes = 0;
  const sources = documents.map(doc => {
    if (typeof doc.text !== 'string' || typeof doc.virtualPath !== 'string' || !doc.virtualPath) {
      throw fail('Invocation needs actual selected source bytes and paths.');
    }
    bytes += Buffer.byteLength(doc.text);
    if (bytes > 256 * 1024 * 1024) throw fail('Invocation source inventory exceeds its byte allowance.');
    return { path: fileKey(path.resolve(ctx.repoRoot, doc.containerPath || doc.virtualPath)),
      virtualPath: doc.virtualPath, hash: createHash('sha256').update(doc.text).digest('hex'),
      languageId: doc.languageId || null, effectiveExt: doc.effectiveExt || null,
      segmentUid: doc.segmentUid || null, segmentId: doc.segmentId || null,
      segmentStart: doc.segmentStart ?? null, segmentEnd: doc.segmentEnd ?? null,
      lineStart: doc.lineStart ?? null, lineEnd: doc.lineEnd ?? null };
  });
  const serializedTargets = canonicalSemanticJson(targets, { maxBytes: 32 * 1024 * 1024,
    check: () => throwIfAborted(inputs.abortSignal) });
  const configuration = canonicalSemanticJson(ctx.toolingConfig || {}, { maxBytes: 8 * 1024 * 1024,
    check: () => throwIfAborted(inputs.abortSignal) });
  return { sources, key: semanticHash('tooling.provider-invocation-inputs.v1', {
    repoRoot: fileKey(ctx.repoRoot), mode: ctx.mode || null, buildRoot: ctx.buildRoot || null, buildId: ctx.buildId || null,
    sources, targets: JSON.parse(serializedTargets), kinds: inputs.kinds || null, configuration: JSON.parse(configuration)
  }) };
};

/** A trusted launch owner captures its actual invocation in execute. Preparation
 * observes only; it must not start children or retain resources in a discarded
 * plan. An observation supplied by the host cannot manufacture this capability.
 * The owner must bind actual module/command/project/environment selection in
 * its profile; unknown closure remains ineligible through the profile owner. */
export const createObservedProviderInvocation = async ({ ctx, inputs, profile, execute }) => {
  if (typeof execute !== 'function' || !ctx?.repoRoot || !profile) throw fail('Invocation needs its original execution owner and observed profile.');
  const snapshot = freeze(JSON.parse(canonicalSemanticJson(profile, { maxBytes: 8 * 1024 * 1024,
    check: () => throwIfAborted(inputs.abortSignal) })));
  const profileHash = providerProfileCacheIdentity(snapshot, { providerId: snapshot.providerId,
    adapterVersion: snapshot.adapterVersion, repoRoot: ctx.repoRoot });
  if (!profileHash) throw fail('Invocation profile is incomplete or belongs to another repository.');
  const selected = inputIdentity(ctx, inputs);
  const observed = new Map(snapshot.sources.map(source => [fileKey(source.path), source.hash]));
  const actual = new Map(selected.sources.map(source => [source.path, source.hash]));
  if (observed.size !== actual.size || selected.sources.some(source => observed.get(source.path) !== source.hash)) {
    throw fail('Observed profile does not describe the actual selected invocation sources.');
  }
  await verifyProviderProfileReceipt(snapshot, { signal: inputs.abortSignal });
  const identity = { schemaVersion: 1, providerId: snapshot.providerId, adapterVersion: snapshot.adapterVersion,
    profileHash, inputIdentity: selected.key };
  const invocation = freeze({ ...identity, invocationHash: semanticHash('tooling.provider-invocation.v1', identity) });
  owners.set(invocation, { profile: snapshot, ctx, inputs, execute, running: null });
  return invocation;
};

export const matchObservedProviderInvocation = (invocation, { ctx, inputs, providerId, adapterVersion, profileHash }) => {
  if (!invocation || !owners.has(invocation)) return false;
  return invocation.providerId === providerId && invocation.adapterVersion === adapterVersion
    && invocation.profileHash === profileHash && invocation.inputIdentity === inputIdentity(ctx, inputs).key;
};

export const matchesProviderInvocationWitness = (witness, invocation) => Boolean(witness && invocation && owners.has(invocation)
  && canonicalSemanticJson(witness, { maxBytes: 16 * 1024 }) === canonicalSemanticJson(invocation));

/** Execute the captured owner, never an independently re-resolved provider.run.
 * Only this boundary attaches the exact invocation witness after settlement. */
export const runObservedProviderInvocation = (invocation, { signal } = {}) => {
  const owner = owners.get(invocation);
  if (!owner) throw fail('Unknown or serialized invocation capability.');
  if (!owner.running) owner.running = (async () => {
    throwIfAborted(signal);
    await verifyProviderProfileReceipt(owner.profile, { signal });
    if (inputIdentity(owner.ctx, owner.inputs).key !== invocation.inputIdentity) throw fail('Invocation inputs changed before execution.');
    const output = await owner.execute();
    const observation = observeStorageResource(output, { phase: 'provider-invocation-result' });
    observation.requireSettled(); throwIfAborted(signal);
    await verifyProviderProfileReceipt(owner.profile, { signal });
    if (inputIdentity(owner.ctx, owner.inputs).key !== invocation.inputIdentity) throw fail('Invocation inputs changed during execution.');
    observation.requireSettled();
    return output ? { ...output, invocation } : output;
  })();
  return owner.running;
};
