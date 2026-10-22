import { throwIfAborted } from '../abort.js';
import path from 'node:path';
import { readVerifiedContainedFile } from '../contained-file.js';
import { assertCurrentIndexFormat } from '../../contracts/index-format.js';
import { Unpackr } from 'msgpackr';
import {
  BUNDLE_CHECKSUM_SCHEMA_VERSION,
  BUNDLE_FORMAT_TAG,
  BUNDLE_VERSION
} from '../bundle-io-constants.js';
import {
  isSupportedChecksumSchemaVersion,
  readChecksumDescriptor,
  verifyBundleChecksum
} from '../bundle-io-checksum.js';
import {
  resolveBundleFormatFromName,
  resolveBundleJsonChecksumPath
} from '../bundle-io-paths.js';
import {
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_CHECKSUM_BYTES
} from '../bundle-contract.js';
import { checksumBundlePayload } from './support.js';
import { applyBundlePatch, readBundlePatches } from './patch.js';
import { normalizeBundleSourceKeys } from '../bundle-source-key.js';

const unpackr = new Unpackr({ useRecords: false });
const normalizeRead = (result, signal = null) => {
  throwIfAborted(signal);
  if (!result.ok) return result;
  try { return { ...result, bundle: normalizeBundleSourceKeys(result.bundle) }; }
  catch { return { ok: false, reason: 'invalid bundle source key' }; }
};

export async function readBundleFile(bundlePath, { format = null, maxBytes = MAX_BUNDLE_BYTES, repoRoot = process.cwd(), signal = null, expectedEncodedBytes = null, expectedPatchBytes = null } = {}) {
  const gate = (value, component) => assertCurrentIndexFormat({
    operation: 'import', component, foundVersion: value?.artifactSurfaceVersion, repoRoot, indexPath: bundlePath
  });
  const boundedBytes = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, MAX_BUNDLE_BYTES) : MAX_BUNDLE_BYTES;
  let encoded;
  try { encoded = await readVerifiedContainedFile(path.dirname(bundlePath), bundlePath, {
    maxBytes: boundedBytes, expectedBytes: expectedEncodedBytes, signal }); }
  catch (error) { if (error.code === 'ERR_FILE_TOO_LARGE') return { ok: false, reason: 'bundle too large' }; throw error; }
  throwIfAborted(signal);
  const resolvedFormat = format || resolveBundleFormatFromName(bundlePath);
  if (resolvedFormat === 'msgpack') {
    const buffer = encoded.buffer;
    const envelope = unpackr.unpack(buffer);
    if (!envelope || typeof envelope !== 'object') {
      return { ok: false, reason: 'invalid bundle envelope' };
    }
    gate(envelope, 'bundle envelope');
    assertCurrentIndexFormat({ operation: 'import', component: 'bundle envelope schema',
      foundVersion: envelope.version, expectedVersion: BUNDLE_VERSION, repoRoot, indexPath: bundlePath });
    if (envelope.format !== BUNDLE_FORMAT_TAG) {
      return { ok: false, reason: 'unsupported bundle envelope' };
    }
    gate(envelope, 'bundle envelope');
    const payload = envelope.payload;
    gate(payload, 'bundle payload');
    if (!payload || !Array.isArray(payload.chunks)) {
      return { ok: false, reason: 'invalid bundle payload' };
    }
    const checksumEnvelope = envelope.checksum;
    if (checksumEnvelope != null) {
      const descriptor = readChecksumDescriptor(
        checksumEnvelope,
        BUNDLE_CHECKSUM_SCHEMA_VERSION
      );
      if (!descriptor.ok) {
        return descriptor;
      }
      return normalizeRead(await verifyBundleChecksum({
        bundle: payload,
        checksum: descriptor.checksum,
        supportedVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
        maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES,
        checksumBundlePayload
      }), signal);
    }
    return normalizeRead({ ok: true, bundle: payload }, signal);
  }
  const raw = encoded.buffer.toString('utf8');
  let bundle = null;
  try {
    bundle = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid bundle' };
  }
  gate(bundle, 'bundle payload');
  if (!bundle || !Array.isArray(bundle.chunks)) {
    return { ok: false, reason: 'invalid bundle' };
  }
  const patches = await readBundlePatches(bundlePath, { repoRoot, signal, expectedBytes: expectedPatchBytes });
  throwIfAborted(signal);
  if (!patches.ok) {
    return { ok: false, reason: 'invalid bundle patch' };
  }
  if (patches.patches.length) {
    let patchedBundle = bundle;
    try {
      for (const patch of patches.patches) {
        patchedBundle = applyBundlePatch({ bundle: patchedBundle, patch });
      }
    } catch {
      return { ok: false, reason: 'invalid bundle patch' };
    }
    if (!patchedBundle || !Array.isArray(patchedBundle.chunks)) {
      return { ok: false, reason: 'invalid bundle patch' };
    }
    gate(patchedBundle, 'patched bundle payload');
    bundle = patchedBundle;
  }
  try {
    const checksumPath = resolveBundleJsonChecksumPath(bundlePath);
    const checksumRead = await readVerifiedContainedFile(path.dirname(checksumPath), checksumPath, { maxBytes: 65536, signal });
    const rawChecksum = checksumRead.buffer.toString('utf8');
    const parsedChecksum = JSON.parse(rawChecksum);
    const checksum = parsedChecksum?.checksum;
    if (!isSupportedChecksumSchemaVersion(
      parsedChecksum?.checksumSchemaVersion,
      BUNDLE_CHECKSUM_SCHEMA_VERSION
    )) {
      return { ok: false, reason: 'unsupported bundle checksum schema' };
    }
    const descriptor = readChecksumDescriptor(checksum, BUNDLE_CHECKSUM_SCHEMA_VERSION);
    if (!descriptor.ok) {
      return descriptor;
    }
    const verified = await verifyBundleChecksum({
      bundle,
      checksum: descriptor.checksum,
      supportedVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION,
      maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES,
      checksumBundlePayload
    });
    if (!verified.ok) {
      return verified;
    }
  } catch (err) {
    throwIfAborted(signal);
    if (['EACCES', 'EPERM'].includes(err?.code)) throw err;
    if (err?.code !== 'ENOENT') {
      return { ok: false, reason: 'invalid bundle checksum' };
    }
  }
  return normalizeRead({ ok: true, bundle }, signal);
}
